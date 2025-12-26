use std::time::Duration;

use serde::Deserialize;

use crate::{handler::Handler, image::ImageProccessor, signature::Verifier};

mod exif;
mod handler;
mod image;
mod server;
mod signature;

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

#[derive(Deserialize)]
struct EnvConfig {
    port: Option<u16>,
    verify_keys: Option<String>,
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let config: EnvConfig = envy::from_env().unwrap();

    let verifier = config.verify_keys.map(|keys| {
        Verifier::new(keys.split(',').map(ToOwned::to_owned))
            .expect("invalid verification key provided")
    });

    let client = reqwest::Client::builder()
        .user_agent(server::NAME_VERSION)
        .timeout(Duration::from_secs(60))
        .build()
        .unwrap();

    let workers = std::thread::available_parallelism().unwrap().get();
    let processor = ImageProccessor::new(workers);

    let state = Handler::new(client, processor, workers * 10, verifier);

    let port = config.port.unwrap_or(8000);
    let addr = format!("0.0.0.0:{port}");
    server::start_server(state, &addr).await.unwrap();
}
