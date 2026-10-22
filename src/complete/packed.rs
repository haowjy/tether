//! Strings end to end in one buffer, with where each ends: an index of thousands of
//! lines or names is two allocations, which go back to the kernel whole when the idle
//! drop frees them (complete.md "Memory, CPU and threads").

#[derive(Debug, Default)]
pub struct Packed {
    text: String,
    ends: Vec<u32>,
}

impl Packed {
    pub fn with_capacity(bytes: usize, count: usize) -> Self {
        Self {
            text: String::with_capacity(bytes),
            ends: Vec::with_capacity(count),
        }
    }

    pub fn push(&mut self, piece: &str) {
        self.text.push_str(piece);
        self.ends
            .push(u32::try_from(self.text.len()).unwrap_or(u32::MAX));
    }

    pub fn len(&self) -> usize {
        self.ends.len()
    }

    pub fn get(&self, i: usize) -> &str {
        let start = i.checked_sub(1).map_or(0, |prev| self.ends[prev]) as usize;
        &self.text[start..self.ends[i] as usize]
    }

    pub fn iter(&self) -> impl Iterator<Item = &str> {
        (0..self.len()).map(|i| self.get(i))
    }

    /// In a sorted `Packed`: the index of the first piece not less than `key`.
    pub fn lower_bound(&self, key: &str) -> usize {
        let (mut low, mut high) = (0, self.len());
        while low < high {
            let mid = (low + high) / 2;
            if self.get(mid) < key {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        low
    }

    /// In a sorted `Packed`: where `key` is.
    pub fn find(&self, key: &str) -> Option<usize> {
        let at = self.lower_bound(key);
        (at < self.len() && self.get(at) == key).then_some(at)
    }

    /// Heap bytes held, for the carapace cache's bound.
    pub fn bytes(&self) -> usize {
        self.text.len() + self.ends.len() * 4
    }
}
