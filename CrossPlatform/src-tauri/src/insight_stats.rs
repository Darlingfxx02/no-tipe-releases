// Word edits, ignoring case and surrounding punctuation. Keep large imported
// documents out of a quadratic calculation rather than inventing a count.
pub fn corrected_words(before: &str, after: &str) -> Option<u64> {
    let words = |text: &str| -> Vec<String> {
        text.split_whitespace().map(|word| word.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase()).filter(|word| !word.is_empty()).collect()
    };
    let a = words(before); let b = words(after);
    let prefix = a.iter().zip(&b).take_while(|(a,b)| a == b).count();
    let a = &a[prefix..]; let b = &b[prefix..];
    let suffix = a.iter().rev().zip(b.iter().rev()).take_while(|(a,b)| a == b).count();
    let a = &a[..a.len()-suffix]; let b = &b[..b.len()-suffix];
    if a.len().saturating_mul(b.len()) > 1_000_000 { return None; }
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, word) in a.iter().enumerate() {
        let mut diagonal = row[0]; row[0] = i+1;
        for (j, output) in b.iter().enumerate() {
            let above = row[j+1];
            row[j+1] = (diagonal + usize::from(word != output)).min(above+1).min(row[j]+1);
            diagonal = above;
        }
    }
    Some(row[b.len()] as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counts_insertions_deletions_and_substitutions_not_punctuation() {
        assert_eq!(corrected_words("Hello world", "hello, world!"), Some(0));
        assert_eq!(corrected_words("Send this tomorrow", "Send it today please"), Some(3));
        assert_eq!(corrected_words("one two three", "one three"), Some(1));
        assert_eq!(corrected_words("", "one two"), Some(2));
        assert_eq!(corrected_words("Привет мир", "Привет, мир!"), Some(0));
    }
    #[test]
    fn avoids_unbounded_work_but_handles_large_identical_transcripts() {
        let a = "alpha ".repeat(2000); let b = "beta ".repeat(2000);
        assert_eq!(corrected_words(&a,&b), None);
        assert_eq!(corrected_words(&a,&a), Some(0));
    }
}
