use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct Config {
    pub parallelism: Parallelism,
}

#[derive(Serialize, Deserialize)]
pub enum Parallelism {
    Server {
        num_threads: usize,
        gpu_enabled: bool,
    },
    Wasm {
        num_threads: usize,
        gpu_enabled: bool,
    },
}

impl Config {
    #[must_use]
    pub fn is_parallel(&self) -> bool {
        use Parallelism::{Server, Wasm};
        match self.parallelism {
            // Default to serial if the user selects only 1 thread (for now)
            Server { num_threads, .. } => num_threads > 1,

            // Default to serial for now
            // Places in the code that know how to take advantage of wasm parallel
            // can be smart enought to handle it on their own
            Wasm { .. } => false,
        }
    }

    #[must_use]
    pub fn server_parallel() -> Self {
        Self {
            parallelism: Parallelism::Server {
                num_threads: 32,
                gpu_enabled: false,
            },
        }
    }
    #[must_use]
    pub fn wasm_parallel() -> Self {
        Self {
            parallelism: Parallelism::Wasm {
                num_threads: 16,
                gpu_enabled: false,
            },
        }
    }
    #[must_use]
    pub fn server_serial() -> Self {
        Self {
            parallelism: Parallelism::Server {
                num_threads: 1,
                gpu_enabled: false,
            },
        }
    }
    #[must_use]
    pub fn wasm_serial() -> Self {
        Self {
            parallelism: Parallelism::Wasm {
                num_threads: 1,
                gpu_enabled: false,
            },
        }
    }
}

impl std::default::Default for Config {
    fn default() -> Config {
        Config::server_parallel()
    }
}
