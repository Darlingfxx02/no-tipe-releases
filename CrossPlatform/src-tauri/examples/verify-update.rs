//! Verify a locally built package against the public key embedded in No Type.
use base64::Engine;
use minisign_verify::{PublicKey, Signature};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let arguments: Vec<_> = std::env::args().collect();
    if arguments.len() != 3 { return Err("Usage: verify-update PACKAGE VERSION".into()); }
    let decode = |value: &str| -> Result<String, Box<dyn std::error::Error>> {
        Ok(String::from_utf8(base64::engine::general_purpose::STANDARD.decode(value.trim())?)?)
    };
    #[cfg(feature = "dev-channel")]
    let public = include_str!("../../updater-dev.pub");
    #[cfg(not(feature = "dev-channel"))]
    let public = include_str!("../../updater.pub");
    let key = PublicKey::decode(&decode(public)?)?;
    let signature = Signature::decode(&decode(&std::fs::read_to_string(format!("{}.sig", arguments[1]))?)?)?;
    let bytes = std::fs::read(&arguments[1])?;
    key.verify(&bytes, &signature, true)?;
    if !signature.trusted_comment().ends_with(&format!("\tversion:{}", arguments[2])) {
        return Err("The signature is not bound to the announced app version".into());
    }
    let mut tampered = bytes;
    if let Some(first) = tampered.first_mut() { *first ^= 1; }
    if key.verify(&tampered, &signature, true).is_ok() {
        return Err("Modified package unexpectedly passed verification".into());
    }
    println!("Verified updater package and signed version; modified bytes rejected.");
    Ok(())
}
