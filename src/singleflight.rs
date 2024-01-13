use std::{
    borrow::ToOwned,
    cmp::Eq,
    future::Future,
    hash::Hash,
    sync::{Arc, Mutex},
};

use ahash::AHashMap;
use tokio::sync::watch::{channel, Receiver, Sender};

#[derive(Clone, Debug, Default)]
pub struct Group<K, T> {
    inner: Arc<Mutex<AHashMap<K, Receiver<Option<T>>>>>,
}

impl<'a, K, T> Group<K, T>
where
    K: Hash + Eq + ToOwned<Owned = K>,
    T: Clone,
{
    pub fn new() -> Self {
        Group {
            inner: Arc::new(Mutex::new(AHashMap::new())),
        }
    }

    pub async fn run<F, Fut>(&self, key: &K, func: F) -> T
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = T>,
    {
        loop {
            match self.get_state(key) {
                State::Sender((tx, guard)) => {
                    let res = func().await;
                    drop(guard);

                    if !tx.is_closed() {
                        let _ = tx.send(Some(res.clone()));
                    }

                    return res;
                }
                State::Receiver(mut rx) => {
                    if rx.changed().await.is_ok() {
                        if let Some(res) = rx.borrow().to_owned() {
                            return res;
                        }
                    }
                }
            }
        }
    }

    pub fn _forget(&self, key: &K) -> bool {
        self.inner.lock().unwrap().remove(key).is_some()
    }

    #[inline]
    fn get_state(&'a self, key: &'a K) -> State<'a, K, T> {
        let mut mu = self.inner.lock().unwrap();
        if let Some(value) = mu.get(key) {
            State::Receiver(value.clone())
        } else {
            let (tx, rx) = channel(None);
            mu.insert(key.to_owned(), rx);
            let guard = Guard {
                key,
                inner: &self.inner,
            };
            State::Sender((tx, guard))
        }
    }
}

enum State<'a, K: Hash + Eq, T> {
    Sender((Sender<Option<T>>, Guard<'a, K, T>)),
    Receiver(Receiver<Option<T>>),
}

struct Guard<'a, K: Hash + Eq, T> {
    key: &'a K,
    inner: &'a Mutex<AHashMap<K, Receiver<Option<T>>>>,
}

impl<'a, K: Hash + Eq, T> Drop for Guard<'a, K, T> {
    fn drop(&mut self) {
        self.inner.lock().unwrap().remove(self.key);
    }
}
