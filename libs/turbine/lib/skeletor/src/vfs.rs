use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::Path,
};

use codegen::{Directory, File};
use proc_macro2::{Ident, Span, TokenStream};
use quote::quote;

use crate::Style;

#[derive(Debug)]
pub(crate) enum VirtualFile {
    Lib { body: TokenStream },
    Mod { body: TokenStream },
    Rust { name: String, body: TokenStream },
}

impl VirtualFile {
    fn name(&self) -> &str {
        match self {
            Self::Lib { .. } => "lib",
            Self::Mod { .. } => "mod",
            Self::Rust { name, .. } => name.as_str(),
        }
    }

    const fn extension(&self) -> &str {
        match self {
            Self::Lib { .. } | Self::Mod { .. } | Self::Rust { .. } => "rs",
        }
    }

    const fn contents(&self) -> &TokenStream {
        match self {
            Self::Lib { body } | Self::Mod { body } | Self::Rust { body, .. } => body,
        }
    }

    #[allow(clippy::missing_const_for_fn)]
    fn into_contents(self) -> TokenStream {
        match self {
            Self::Lib { body } | Self::Mod { body } | Self::Rust { body, .. } => body,
        }
    }
}

#[derive(Debug)]
pub(crate) struct VirtualFolder {
    name: String,

    files: HashMap<String, VirtualFile>,
    folders: HashMap<String, VirtualFolder>,
}

impl VirtualFolder {
    pub(crate) fn new(name: String) -> Self {
        Self {
            name,
            files: HashMap::new(),
            folders: HashMap::new(),
        }
    }

    pub(crate) fn generate_body(&self) -> TokenStream {
        let files = self.files.values().filter_map(|file| match file {
            VirtualFile::Mod { .. } | VirtualFile::Lib { .. } => None,
            VirtualFile::Rust { name, .. } => Some(Ident::new(name, Span::call_site())),
        });

        let folders = self
            .folders
            .keys()
            .map(|name| Ident::new(name, Span::call_site()));

        quote! {
            #(pub mod #files;)*

            #(pub mod #folders;)*
        }
    }

    fn should_normalize(&self, parent: &Self, style: Style) -> bool {
        match style {
            // check if we already have a mod.rs, in that case just abort
            Style::Mod => {
                if self
                    .files
                    .values()
                    .any(|file| matches!(file, VirtualFile::Mod { .. }))
                {
                    return false;
                }
            }
            // check if we already have a mod.rs in the parent, in that case just abort
            Style::Module => {
                if parent.files.values().any(|file| match file {
                    VirtualFile::Rust { name, .. } => *name == self.name,
                    _ => false,
                }) {
                    return false;
                }
            }
        }

        true
    }

    fn normalize_mod(&mut self) {
        // practically the same, as `normalize_module`, but instead creates a `mod.rs` file

        let body = self.generate_body();

        self.files
            .insert("mod".to_owned(), VirtualFile::Mod { body });
    }

    fn normalize_module(&mut self) -> VirtualFile {
        // at this point we do not have a module.rs
        // 1) collect all children that are rust and create a `pub mob` (not `mod.rs` files)
        // 2) create a new file called `name.rs`

        let body = self.generate_body();

        VirtualFile::Rust {
            name: self.name.clone(),
            body,
        }
    }

    pub(crate) fn normalize(&mut self, style: Style) -> Option<VirtualFile> {
        let result = match style {
            Style::Mod => {
                self.normalize_mod();
                None
            }
            Style::Module => Some(self.normalize_module()),
        };

        let should_normalize: HashSet<_> = self
            .folders
            .iter()
            .filter(|(_, value)| value.should_normalize(self, style))
            .map(|(key, _)| key.clone())
            .collect();

        for (name, folder) in &mut self.folders {
            if !should_normalize.contains(name) {
                continue;
            }

            if let Some(file) = folder.normalize(style) {
                self.files.insert(file.name().to_owned(), file);
            }
        }

        result
    }

    pub(crate) fn normalize_top_level(&mut self, style: Style, utilities: &TokenStream) {
        let top_level = quote! {
            #![no_std]
            #![allow(clippy::all)]
            #![allow(clippy::pedantic)]
            #![allow(clippy::nursery)]
            #![allow(unsafe_code)]
            #![allow(clippy::undocumented_unsafe_blocks)] // present in the code generator
            #![allow(clippy::missing_safety_doc)] // present in the code generator
            #![allow(unused_imports)]
            #![allow(unused_variables)]
            #![allow(unused_mut)]

            use turbine::TypeUrl;
            use turbine::TypeHierarchyResolution as _;

            #utilities

            extern crate alloc;
        };

        let contents = self.normalize(style);
        if let Some(file) = contents {
            let contents = file.into_contents();

            self.files.insert("lib".to_owned(), VirtualFile::Lib {
                body: quote! {
                    #top_level

                    #contents
                },
            });
        }

        if let Some(mod_) = self.files.remove("mod") {
            let contents = mod_.into_contents();

            self.files.insert("lib".to_owned(), VirtualFile::Lib {
                body: quote! {
                    #top_level

                    #contents
                },
            });
        }
    }

    pub(crate) fn insert(
        &mut self,
        mut directories: VecDeque<Directory>,
        file: File,
        contents: TokenStream,
    ) {
        let directory = directories.pop_front();

        if let Some(directory) = directory {
            let name = directory.into_name();

            let folder = self
                .folders
                .entry(name.clone())
                .or_insert_with(|| Self::new(name));

            folder.insert(directories, file, contents);
        } else {
            // we're at the bottom, create the file
            if file.is_mod() {
                self.files
                    .insert("mod".to_owned(), VirtualFile::Mod { body: contents });
            } else {
                let name = file.into_name();

                self.files.insert(name.clone(), VirtualFile::Rust {
                    name,
                    body: contents,
                });
            }
        }
    }

    pub(crate) fn output(self, base: impl AsRef<Path>) -> std::io::Result<()> {
        let base = base.as_ref();

        for (name, file) in self.files {
            let extension = file.extension();

            let path = base.join(name).with_extension(extension);
            std::fs::write(path, file.contents().to_string())?;
        }

        for (name, folder) in self.folders {
            let next = base.join(name);

            std::fs::create_dir_all(&next)?;
            folder.output(&next)?;
        }

        Ok(())
    }
}
