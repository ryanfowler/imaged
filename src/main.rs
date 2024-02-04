use std::time::Duration;

use image::ImageProccessor;

use crate::{
    cache::{disk::DiskCache, memory::MemoryCache},
    handler::Handler,
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
static GLOBAL: jemallocator::Jemalloc = jemallocator::Jemalloc;

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let port = std::env::var("PORT").ok();
    let mem_cache_size = std::env::var("MEM_CACHE_SIZE")
        .ok()
        .map(|v| byte_unit::Byte::parse_str(v, true).expect("invalid value for MEM_CACHE_SIZE"));
    let disk_cache_size = std::env::var("DISK_CACHE_SIZE")
        .ok()
        .map(|v| byte_unit::Byte::parse_str(v, true).expect("invalid value for DISK_CACHE_SIZE"));
    let disk_cache_path = std::env::var("DISK_CACHE_PATH").ok();
    let verify_keys = std::env::var("VERIFY_KEYS").ok();

    if let Some(size) = mem_cache_size {
        println!(
            "Using an in-memory cache of size {}",
            size.get_appropriate_unit(byte_unit::UnitType::Both)
        );
    }
    if let (Some(size), Some(path)) = (disk_cache_size, &disk_cache_path) {
        println!(
            "Using a disk cache of size {} at path {}",
            size.get_appropriate_unit(byte_unit::UnitType::Both),
            &path
        );
    }

    let mem_cache = mem_cache_size
        .map(|v| v.as_u64() as usize)
        .map(MemoryCache::new);

    let disk_cache = if let (Some(size), Some(path)) = (disk_cache_size, disk_cache_path) {
        Some(DiskCache::new(path.into(), size.as_u64()).await.unwrap())
    } else {
        None
    };

    let verifier = verify_keys.map(|keys| {
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

    let port = port.unwrap_or_else(|| "8000".to_string());
    let addr = format!("0.0.0.0:{port}");
    server::start_server(state, &addr).await.unwrap();
}
