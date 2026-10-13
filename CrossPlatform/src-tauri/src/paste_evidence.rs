// UI Automation and macOS Accessibility selections use UTF-16 offsets.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Selection {
    pub start: usize,
    pub length: usize,
}

pub(crate) fn insertion_confirmed(
    before: &str,
    selection: Option<Selection>,
    after: &str,
    after_selection: Option<Selection>,
    text: &str,
) -> bool {
    if text.is_empty() {
        return false;
    }
    let old: Vec<_> = before.encode_utf16().collect();
    let inserted: Vec<_> = text.encode_utf16().collect();
    if let Some(range) = selection {
        if range.start <= old.len() && range.length <= old.len() - range.start {
            let mut expected = old[..range.start].to_vec();
            expected.extend_from_slice(&inserted);
            expected.extend_from_slice(&old[range.start + range.length..]);
            if let Ok(expected) = String::from_utf16(&expected) {
                if expected.replace("\r\n", "\n") == after.replace("\r\n", "\n") {
                    return before != after
                        || (range.length > 0
                            && after_selection
                                == Some(Selection {
                                    start: range.start + inserted.len(),
                                    length: 0,
                                }));
                }
            }
        }
    }
    let old: Vec<_> = before.replace("\r\n", "\n").encode_utf16().collect();
    let new: Vec<_> = after.replace("\r\n", "\n").encode_utf16().collect();
    let text: Vec<_> = text.replace("\r\n", "\n").encode_utf16().collect();
    if old == new || text.len() > new.len() {
        return false;
    }
    let prefix = old.iter().zip(&new).take_while(|(a, b)| a == b).count();
    let suffix = old[prefix..]
        .iter()
        .rev()
        .zip(new[prefix..].iter().rev())
        .take_while(|(a, b)| a == b)
        .count();
    let changed_end = new.len() - suffix;
    // Preserve support for editors that add formatting around a fresh insert.
    if new[prefix..changed_end]
        .windows(text.len())
        .any(|part| part == text)
    {
        return true;
    }
    // A replacement may share characters with the selected text. The full
    // pasted phrase must cover the changed span and preserve everything outside
    // its range; searching only the minimal diff would discard shared letters.
    (changed_end.saturating_sub(text.len())..=prefix.min(new.len() - text.len())).any(|start| {
        let end = start + text.len();
        end >= changed_end && new[start..end] == text && start + new.len() - end <= old.len()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn range(start: usize, length: usize) -> Option<Selection> {
        Some(Selection { start, length })
    }

    #[test]
    fn replacements_preserve_surrounding_text() {
        for (old, new) in [
            ("old", "new"),
            ("old", "older"),
            ("old", "bold"),
            ("abXd", "abcd"),
            ("long text", "x"),
            ("", "fresh"),
            ("aaaX", "aaa"),
        ] {
            let before = format!("prefix {old} suffix");
            let after = format!("prefix {new} suffix");
            assert!(
                insertion_confirmed(&before, None, &after, None, new),
                "{old} -> {new}"
            );
            assert!(insertion_confirmed(
                &before,
                range(7, old.encode_utf16().count()),
                &after,
                None,
                new
            ));
        }
        assert!(insertion_confirmed("old", None, "new", None, "new"));
        assert!(insertion_confirmed("", None, "new\n", None, "new"));
        assert!(insertion_confirmed(
            "🙂 old 🌊",
            range(3, 3),
            "🙂 Привет 🌊",
            None,
            "Привет"
        ));
    }

    #[test]
    fn identical_replacement_needs_a_collapsed_selection() {
        assert!(!insertion_confirmed(
            "same",
            range(0, 4),
            "same",
            range(0, 4),
            "same"
        ));
        assert!(!insertion_confirmed("same", None, "same", None, "same"));
        assert!(insertion_confirmed(
            "same",
            range(0, 4),
            "same",
            range(4, 0),
            "same"
        ));
    }

    #[test]
    fn normalize_editor_newlines() {
        assert!(insertion_confirmed(
            "prefix first\nold suffix",
            range(7, 9),
            "prefix first\r\nnew suffix",
            None,
            "first\nnew"
        ));
        assert!(insertion_confirmed(
            "first\nold",
            None,
            "first\r\nnew",
            None,
            "first\nnew"
        ));
    }

    #[test]
    fn existing_text_and_unrelated_edits_are_not_proof() {
        assert!(!insertion_confirmed(
            "already here",
            None,
            "already here!",
            None,
            "already"
        ));
        assert!(!insertion_confirmed(
            "new old",
            None,
            "new other",
            None,
            "new"
        ));
        assert!(!insertion_confirmed(
            "old",
            range(usize::MAX, 3),
            "unrelated",
            None,
            "text"
        ));
        assert!(!insertion_confirmed("old", None, "changed", None, ""));
    }
}
