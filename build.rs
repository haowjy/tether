use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const TOTAL_LIMIT: u64 = 3 * 1024 * 1024;
const FILE_LIMIT: u64 = 1536 * 1024;
const FILES_LIMIT: usize = 128;

fn main() {
    let root = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let web = root.join("web");
    track_sources(&web);
    let status = Command::new("pnpm")
        .args(["run", "build"])
        .current_dir(&web)
        .status()
        .expect("run pnpm to build the embedded browser shell");
    assert!(status.success(), "pnpm run build failed for web/");

    let dist = web.join("dist");
    let mut files = Vec::new();
    visit(&dist, &dist, &mut files);
    files.sort_by(|a, b| a.0.cmp(&b.0));
    let total = files
        .iter()
        .map(|(_, path)| fs::metadata(path).expect("asset metadata").len())
        .sum::<u64>();
    assert!(
        files.len() <= FILES_LIMIT,
        "embedded shell has {} files (limit {FILES_LIMIT})",
        files.len()
    );
    assert!(
        total <= TOTAL_LIMIT,
        "embedded shell is {total} bytes (limit {TOTAL_LIMIT})"
    );

    let out = PathBuf::from(std::env::var_os("OUT_DIR").expect("OUT_DIR"));
    let mut generated = String::from("pub static ASSETS: &[Asset] = &[\n");
    for (index, (name, path)) in files.iter().enumerate() {
        let raw = fs::metadata(path).expect("asset metadata").len();
        assert!(
            raw <= FILE_LIMIT,
            "embedded asset {name} is {raw} bytes (limit {FILE_LIMIT})"
        );
        // Both copies live in OUT_DIR: web/dist is rewritten by any `pnpm run build`, which
        // doesn't rerun this script, so the table must not point into it.
        let copied = out.join(format!("asset-{index}.raw"));
        fs::copy(path, &copied).expect("copy asset");
        let gzip = gzip(path);
        let compressed = out.join(format!("asset-{index}.gz"));
        fs::write(&compressed, gzip).expect("write compressed asset");
        let path_text = format!("{:?}", name);
        let raw_path = format!("{:?}", copied);
        let gzip_path = format!("{:?}", compressed);
        generated.push_str(&format!(
            "    Asset {{ path: {path_text}, raw: include_bytes!({raw_path}), gzip: include_bytes!({gzip_path}) }},\n"
        ));
    }
    generated.push_str("];\n");
    fs::write(out.join("shell_assets.rs"), generated).expect("write shell asset table");
}

fn track_sources(web: &Path) {
    println!("cargo:rerun-if-changed=build.rs");
    let mut dirs = vec![web.to_owned()];
    while let Some(dir) = dirs.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name();
            if name == "node_modules" || name == "dist" || name == "test-results" {
                continue;
            }
            if path.is_dir() {
                dirs.push(path.clone());
            }
            println!("cargo:rerun-if-changed={}", path.display());
        }
    }
}

fn visit(root: &Path, dir: &Path, files: &mut Vec<(String, PathBuf)>) {
    for entry in fs::read_dir(dir).expect("web/dist exists").flatten() {
        let path = entry.path();
        let name = entry.file_name();
        if name == ".vite" {
            continue;
        }
        if path.is_dir() {
            visit(root, &path, files);
        } else {
            let relative = path.strip_prefix(root).expect("under dist");
            let wire = relative
                .to_str()
                .expect("UTF-8 asset path")
                .replace('\\', "/");
            files.push((format!("/{wire}"), path));
        }
    }
}

fn gzip(path: &Path) -> Vec<u8> {
    let bytes = fs::read(path).expect("read asset");
    let mut child = Command::new("gzip")
        .args(["-n", "-9", "-c"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("gzip is available on POSIX build hosts");
    child
        .stdin
        .take()
        .expect("gzip stdin")
        .write_all(&bytes)
        .expect("write gzip input");
    let output = child.wait_with_output().expect("finish gzip");
    assert!(
        output.status.success(),
        "gzip failed for {}",
        path.display()
    );
    output.stdout
}
