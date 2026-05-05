mod boolean;
mod empty_list;
mod null;
mod number;
mod object;
mod text;

pub use boolean::Boolean;
pub use empty_list::EmptyList;
pub use null::Null;
pub use number::Number;
pub use object::Object;
pub use text::Text;

use crate::path::{Path, TypePath};

pub struct DataTypePath;

impl TypePath for DataTypePath {
    fn path(self) -> Path<'static> {
        Path::new(&[])
    }
}
