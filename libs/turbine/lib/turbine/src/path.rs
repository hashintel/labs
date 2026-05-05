use alloc::{borrow::Cow, boxed::Box, vec::Vec};
use core::slice;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Segment<'a> {
    Field(Cow<'a, str>),
    Index(usize),
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Next<'a> {
    Borrowed(&'a Path<'a>),
    Owned(Box<Path<'a>>),
}

impl<'a> Next<'a> {
    fn as_ref(&self) -> &Path<'a> {
        match self {
            Self::Borrowed(path) => path,
            Self::Owned(path) => path,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Link<'a> {
    value: Cow<'a, Segment<'a>>,
    next: Option<Next<'a>>,
}

impl<'a> Link<'a> {
    #[must_use]
    pub const fn new(value: &'a Segment<'a>, next: Option<Next<'a>>) -> Self {
        Self {
            value: Cow::Borrowed(value),
            next,
        }
    }

    #[must_use]
    pub fn new_owned(value: Segment<'a>, next: Option<Next<'a>>) -> Self {
        Self {
            value: Cow::Owned(value),
            next,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Path<'a> {
    Borrowed(&'a [Segment<'a>]),
    Owned(Vec<Segment<'a>>),

    Link(Link<'a>),
}

impl<'a> Path<'a> {
    #[must_use]
    pub const fn new(path: &'a [Segment]) -> Self {
        Self::Borrowed(path)
    }

    #[must_use]
    pub fn new_owned(path: Vec<Segment<'a>>) -> Self {
        Self::Owned(path)
    }

    #[must_use]
    pub const fn new_linked(path: Link<'a>) -> Self {
        Self::Link(path)
    }
}

pub enum PathIterator<'a> {
    Slice(slice::Iter<'a, Segment<'a>>),
    Linked(&'a Link<'a>),
    Empty,
}

impl<'a> Iterator for PathIterator<'a> {
    type Item = &'a Segment<'a>;

    fn next(&mut self) -> Option<Self::Item> {
        match self {
            Self::Slice(slice) => slice.next(),
            Self::Linked(node) => {
                let next = node.value.as_ref();

                if let Some(next) = &node.next {
                    *self = match next.as_ref() {
                        Path::Borrowed(slice) => Self::Slice(slice.iter()),
                        Path::Owned(owned) => Self::Slice(owned.iter()),
                        Path::Link(link) => Self::Linked(link),
                    };
                } else {
                    *self = Self::Empty;
                }

                Some(next)
            }
            Self::Empty => None,
        }
    }
}

pub trait TypePath {
    fn path(self) -> Path<'static>;
}

#[cfg(test)]
mod tests {
    #[test]
    fn compile() {}
}
