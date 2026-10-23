//! Fail-closed alignment of physical and joined tmux capture rows.

use bytes::Bytes;

/// Packed row-wrap bits, least-significant bit first. Bit `i` means physical row `i`
/// continues into row `i + 1`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct WrapMap {
    rows: usize,
    bits: Vec<u8>,
}

impl WrapMap {
    pub(crate) fn empty(rows: usize) -> Self {
        Self {
            rows,
            bits: vec![0; rows.div_ceil(8)],
        }
    }

    pub(crate) fn wraps(&self, row: usize) -> bool {
        row < self.rows && self.bits[row / 8] & (1 << (row % 8)) != 0
    }

    fn set(&mut self, row: usize) {
        if row < self.rows {
            self.bits[row / 8] |= 1 << (row % 8);
        }
    }

    pub(crate) fn truncate(&self, rows: usize) -> Self {
        let rows = rows.min(self.rows);
        let mut bits = self.bits[..rows.div_ceil(8)].to_vec();
        if let Some(last) = bits.last_mut()
            && rows % 8 != 0
        {
            *last &= (1 << (rows % 8)) - 1;
        }
        Self { rows, bits }
    }

    pub(crate) fn into_bytes(self) -> Bytes {
        Bytes::from(self.bits)
    }
}

/// Keeps the bitmap in step with a history response shortened to `rows` lines.
pub(crate) fn truncate_packed(bits: &[u8], rows: usize) -> Bytes {
    let length = rows.div_ceil(8);
    let mut prefix = bits[..length.min(bits.len())].to_vec();
    prefix.resize(length, 0);
    if let Some(last) = prefix.last_mut()
        && rows % 8 != 0
    {
        *last &= (1 << (rows % 8)) - 1;
    }
    Bytes::from(prefix)
}

/// Aligns the `-N -T` physical rows with the `-J` logical rows. Their flattened cell
/// bytes must agree exactly; only a physical boundary strictly inside one logical row
/// is a soft wrap. Empty or repeated boundaries remain unset when their position is
/// ambiguous.
pub(crate) fn align(physical: &[Bytes], logical: &[Bytes]) -> WrapMap {
    let mut map = WrapMap::empty(physical.len());
    let total = physical.iter().map(Bytes::len).sum();
    let mut flat = Vec::with_capacity(total);
    let mut physical_ends = Vec::with_capacity(physical.len() + 1);
    physical_ends.push(0);
    for row in physical {
        flat.extend_from_slice(row);
        physical_ends.push(flat.len());
    }

    let mut joined = Vec::with_capacity(flat.len());
    let mut logical_ends = Vec::with_capacity(logical.len());
    for row in logical {
        joined.extend_from_slice(row);
        logical_ends.push(joined.len());
    }
    if flat != joined {
        return map;
    }

    for row in 0..physical.len().saturating_sub(1) {
        let offset = physical_ends[row + 1];
        let left = physical_ends.partition_point(|at| *at < offset);
        let right = physical_ends.partition_point(|at| *at <= offset);
        if right - left != 1 || logical_ends.binary_search(&offset).is_ok() {
            continue;
        }
        let line = logical_ends.partition_point(|end| *end <= offset);
        let line_start = line
            .checked_sub(1)
            .map_or(0, |previous| logical_ends[previous]);
        if logical_ends
            .get(line)
            .is_some_and(|end| line_start < offset && offset < *end)
        {
            map.set(row);
        }
    }
    map
}
