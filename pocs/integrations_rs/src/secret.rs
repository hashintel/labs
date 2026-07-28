//! Wrapper whose Debug/Display never print the value. Wrap anything
//! credential-bearing that travels through task state or error reports, so
//! redaction holds by construction, not by remembering to redact at every
//! print site. `expose` is the single deliberate way in.

#[derive(Clone, PartialEq, Eq)]
pub struct Secret<T>(T);

impl<T> Secret<T> {
    pub fn new(value: T) -> Self {
        Self(value)
    }

    pub fn expose(&self) -> &T {
        &self.0
    }
}

impl<T> core::fmt::Debug for Secret<T> {
    fn fmt(&self, fmt: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        fmt.write_str("Secret<redacted>")
    }
}

impl<T> core::fmt::Display for Secret<T> {
    fn fmt(&self, fmt: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        fmt.write_str("Secret<redacted>")
    }
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]
mod tests {
    use super::Secret;

    #[test]
    fn debug_and_display_redact() {
        let secret = Secret::new("postgres://u:hunter2@h/db".to_owned());
        assert!(!format!("{secret:?}").contains("hunter2"));
        assert!(!format!("{secret}").contains("hunter2"));
        assert!(secret.expose().contains("hunter2"));
    }
}
