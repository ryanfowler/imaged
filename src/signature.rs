use std::borrow::Cow;

use anyhow::{Result, anyhow};
use hex::decode;
use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;
type Key = Vec<u8>;

pub struct Verifier {
    keys: Vec<Key>,
}

impl Verifier {
    pub fn new(input: impl Iterator<Item = String>) -> Result<Self> {
        let keys = input.map(decode).collect::<Result<_, _>>()?;
        Ok(Verifier { keys })
    }

    pub fn verify(&self, path: &str, query: Option<&str>, hex_sig: &[u8]) -> Result<()> {
        let msg = Self::get_message(path, query)
            .map_err(|err| anyhow!(format!("parsing query string: {}", err)))?;

        let sig = decode(hex_sig).map_err(|_| anyhow!("invalid hex signature"))?;
        for key in &self.keys {
            let mut mac = HmacSha256::new_from_slice(key).unwrap();
            mac.update(msg.as_bytes());
            if mac.verify_slice(&sig).is_ok() {
                return Ok(());
            }
        }

        Err(anyhow!("invalid signature provided"))
    }

    fn get_message(path: &str, query: Option<&str>) -> Result<String> {
        let mut out = String::with_capacity(128);

        if !path.starts_with('/') {
            out.push('/');
        }
        out.push_str(path);

        out.push('?');
        if let Some(raw_query) = query {
            let mut query: Vec<(Cow<str>, Cow<str>)> = serde_urlencoded::from_str(raw_query)?;
            query.retain(|(k, _)| k != "s");
            if !query.is_empty() {
                query.sort_by(|(k1, _), (k2, _)| k1.cmp(k2));
                let out_query = serde_urlencoded::to_string(&query)?;
                out.push_str(&out_query);
            }
        }

        Ok(out)
    }
}
