use std::time::Duration;

use serde::Deserialize;

use crate::{
    cache::{disk::DiskCache, memory::MemoryCache},
    handler::Handler,
    image::ImageProccessor,
    signature::Verifier,
};

mod cache;
mod exif;
mod handler;
mod image;
mod server;
mod signature;
mod singleflight;

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

#[derive(Deserialize)]
struct EnvConfig {
    disk_cache_path: Option<String>,
    disk_cache_size: Option<byte_unit::Byte>,
    mem_cache_size: Option<byte_unit::Byte>,
    port: Option<u16>,
    verify_keys: Option<String>,
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let config: EnvConfig = envy::from_env().unwrap();

    if let Some(size) = config.mem_cache_size {
        println!(
            "Using an in-memory cache of size {}",
            size.get_appropriate_unit(byte_unit::UnitType::Both)
        );
    }
    if let (Some(size), Some(path)) = (config.disk_cache_size, &config.disk_cache_path) {
        println!(
            "Using a disk cache of size {} at path {}",
            size.get_appropriate_unit(byte_unit::UnitType::Both),
            &path
        );
    }

    let mem_cache = config
        .mem_cache_size
        .map(|v| v.as_u64() as usize)
        .map(MemoryCache::new);

    let disk_cache =
        if let (Some(size), Some(path)) = (config.disk_cache_size, config.disk_cache_path) {
            Some(DiskCache::new(path.into(), size.as_u64()).await.unwrap())
        } else {
            None
        };

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

    let state = Handler::new(
        mem_cache,
        disk_cache,
        client,
        processor,
        workers * 10,
        verifier,
    );

    let port = config.port.unwrap_or(8000);
    let addr = format!("0.0.0.0:{port}");
    server::start_server(state, &addr).await.unwrap();
}
