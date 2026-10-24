// The client's architecture rules as core ESLint (client-architecture.md §3.3): no plugin,
// only no-restricted-syntax, -imports, -globals and -properties in per-directory blocks.
// Later blocks replace earlier ones for the same rule, so each block lists everything that
// applies to its files. lint/rules.test.ts proves every rule fails on a seeded violation.

const TS = ["**/*.ts", "**/*.tsx"];

// Rule 1: raw editable and interactive elements live only in primitives and the three
// input owners. Screens use TextField, SearchField and Button.
const RAW = "button|input|textarea|select";
const rule1 = [
  {
    selector: `JSXOpeningElement[name.name=/^(${RAW})$/]`,
    message: "Raw <button>/<input>/<textarea>/<select> live only in ui/primitives (and the input owners): use Button, IconButton, Row, TextField or SearchField.",
  },
  { selector: "JSXAttribute[name.name=/^(contentEditable|contenteditable)$/]", message: "contenteditable is banned: use a TextField." },
  {
    selector: `CallExpression[callee.property.name='createElement'][arguments.0.value=/^(${RAW})$/]`,
    message: "Do not create form controls by hand: only ui/primitives and the input owners may.",
  },
];

// Rule 2: only app/focus.ts moves DOM focus.
const rule2 = [
  {
    selector: "CallExpression[callee.property.name=/^(focus|blur)$/], CallExpression[callee.computed=true][callee.property.value=/^(focus|blur)$/]",
    message: "Only app/focus.ts calls .focus() or .blur(): register the element with the focus controller (useFocus()).",
  },
  { selector: "JSXAttribute[name.name=/^(autoFocus|autofocus)$/]", message: "Only app/focus.ts moves focus: autoFocus is banned, register the element with the focus controller (useFocus())." },
];

// Rule 3: environment globals appear only in platform/.
const ENV = ["webkit", "visualViewport", "indexedDB", "localStorage", "sessionStorage", "navigator", "open", "matchMedia", "BroadcastChannel"];
const GLOBAL_OBJECTS = ["window", "globalThis", "self"];
const rule3Globals = ENV.map((name) => ({ name, message: `${name} is environment-specific: it belongs in platform/ behind the Platform interface.` }));
const rule3Properties = [
  ...GLOBAL_OBJECTS.flatMap((object) =>
    ENV.map((property) => ({ object, property, message: `${object}.${property} is environment-specific: it belongs in platform/.` })),
  ),
  { object: "document", property: "visibilityState", message: "Page visibility belongs in platform/ (Lifecycle)." },
  { object: "document", property: "hasFocus", message: "document.hasFocus belongs in platform/." },
];
const rule3Syntax = [
  { selector: "MemberExpression[property.name='webkit']", message: "webkit is environment-specific: it belongs in platform/." },
  {
    selector: `VariableDeclarator[init.name=/^(${GLOBAL_OBJECTS.join("|")})$/] > ObjectPattern`,
    message: "Do not destructure environment globals out of window/globalThis/self: it belongs in platform/.",
  },
];

// Rule 4: import boundaries.
const IMPL = { group: ["**/platform/browser", "**/platform/browser/**", "**/platform/native", "**/platform/native/**"], message: "Only main.tsx imports a platform implementation." };
const TEST_PLATFORM = { group: ["**/platform/test", "**/platform/test/**"], message: "Only tests and harness/ import platform/test." };
const XTERM = { group: ["@xterm/*"], message: "Only term/ imports xterm: go through the renderer boundary in term/index.ts." };

// Rule 5: sans-IO cores have no Preact and no window or document.
const PREACT = { group: ["preact", "preact/*"], message: "This is a sans-IO core: events in, state and effects out, no Preact." };
const rule5Globals = [...rule3Globals, "window", "document"].map((g) => (typeof g === "string" ? { name: g, message: `${g} has no place in a sans-IO core.` } : g));

const syntax = (...sets) => ["error", ...sets.flat()];
const imports = (...patterns) => ["error", { patterns }];
const globals = (list) => ["error", ...list];
const properties = (list) => ["error", ...list];

const CORES = ["workspace/**", "sessions/**", "drafts/**", "tabs/**", "net/admission.ts", "touch/gesture.ts", "touch/modifiers.ts"];
const TESTS = ["**/*.test.ts", "**/*.test.tsx"];

export const rules = [
  {
    files: TS,
    rules: {
      "no-restricted-syntax": syntax(rule1, rule2, rule3Syntax),
      "no-restricted-globals": globals(rule3Globals),
      "no-restricted-properties": properties(rule3Properties),
      "no-restricted-imports": imports(IMPL, TEST_PLATFORM, XTERM),
    },
  },
  // The platform is where environment lives. Its test adapter and the browser's file input are exceptions to rule 1 only where noted.
  {
    files: ["platform/**"],
    rules: {
      "no-restricted-syntax": syntax(rule1, rule2),
      "no-restricted-globals": "off",
      "no-restricted-properties": "off",
    },
  },
  // Tests and the harness stand in for the platform, and may import its test adapter. The
  // specs drive the page, so they may focus elements: rule 2 guards the app, not its tests.
  {
    files: [...TESTS, "harness/**", "e2e/**"],
    rules: {
      "no-restricted-syntax": syntax(rule1),
      "no-restricted-globals": "off",
      "no-restricted-properties": "off",
      "no-restricted-imports": imports(IMPL, XTERM),
    },
  },
  // Retired by the lanes that own its importers: W2 retargets tabs/ and term/size.ts to
  // platform/types, W5 moves the rest into platform/native/ and deletes native/.
  { files: ["native/**"], rules: { "no-restricted-syntax": syntax(rule1, rule2) } },
  { files: ["main.tsx"], rules: { "no-restricted-imports": imports(TEST_PLATFORM, XTERM) } },
  { files: ["term/**"], rules: { "no-restricted-imports": imports(IMPL, TEST_PLATFORM) } },
  // Rule 1's exempt files: the primitives, the two input owners and the hidden file input.
  {
    files: ["ui/primitives/**", "term/xterm-input.ts", "touch/owned-input.ts"],
    rules: { "no-restricted-syntax": syntax(rule2, rule3Syntax) },
  },
  { files: ["platform/browser/uploads.ts"], rules: { "no-restricted-syntax": syntax(rule2) } },
  // Rule 2's one exempt file.
  { files: ["app/focus.ts"], rules: { "no-restricted-syntax": syntax(rule1, rule3Syntax) } },
  // Rule 5: sans-IO cores.
  {
    files: CORES,
    ignores: TESTS,
    rules: {
      "no-restricted-globals": globals(rule5Globals),
      "no-restricted-imports": imports(IMPL, TEST_PLATFORM, XTERM, PREACT),
    },
  },
];
