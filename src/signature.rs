use std::borrow::Cow;

use anyhow::{anyhow, Result};
use ed25519_compact::{PublicKey, Signature};
use hex::decode_to_slice;

pub struct Verifier {
    keys: Vec<PublicKey>,
}

impl Verifier {
    pub fn new(input: impl Iterator<Item = String>) -> Result<Self> {
        let keys = input
            .map(|v| Self::parse_public_key(&v))
            .collect::<Result<_, _>>()?;
        Ok(Verifier { keys })
    }

    pub fn verify(&self, path: &str, query: Option<&str>, hex_sig: &[u8]) -> Result<bool> {
        let msg = Self::get_message(path, query)
            .map_err(|err| anyhow!(format!("parsing query string: {}", err)))?;
        let sig = Self::parse_signature(hex_sig)
            .map_err(|err| anyhow!(format!("parsing signature: {}", err)))?;

        for key in &self.keys {
            if key.verify(msg.as_bytes(), &sig).is_ok() {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn get_message(path: &str, query: Option<&str>) -> Result<String> {
        let mut out = String::with_capacity(128);

        if !path.starts_with('/') {
            out.push('/');
        }
        out.push_str(path);

        if let Some(raw_query) = query {
            let mut query: Vec<(Cow<str>, Cow<str>)> = serde_urlencoded::from_str(raw_query)?;
            query.retain(|(k, _)| k != "s");
            query.sort_by(|(k1, _), (k2, _)| k1.cmp(k2));
            let out_query = serde_urlencoded::to_string(&query)?;
            out.push('?');
            out.push_str(&out_query);
        }

        Ok(out)
    }

    fn parse_signature(hex_sig: &[u8]) -> Result<Signature> {
        let mut bytes = [0u8; Signature::BYTES];
        decode_to_slice(hex_sig, &mut bytes as &mut [u8])?;
        Ok(Signature::new(bytes))
    }

    fn parse_public_key(input: &str) -> Result<PublicKey> {
        let mut bytes = [0u8; PublicKey::BYTES];
        decode_to_slice(input, &mut bytes as &mut [u8])?;
        Ok(PublicKey::new(bytes))
    }
}
