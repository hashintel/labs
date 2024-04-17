use drop_bomb::DropBomb;
use error_stack::Report;

pub(crate) struct ErrorAccumulator<C> {
    inner: Option<Report<C>>,
    bomb: DropBomb,
}

impl<C> ErrorAccumulator<C> {
    pub(crate) fn new() -> Self {
        Self {
            inner: None,
            bomb: DropBomb::new(
                "ErrorAccumulator must be converted into a `Result` using `into_error`",
            ),
        }
    }

    pub(crate) fn push<T>(&mut self, value: Result<T, Report<C>>) -> Option<T> {
        match value {
            Ok(ok) => Some(ok),
            Err(error) => {
                self.extend_one(error);
                None
            }
        }
    }

    pub(crate) fn extend_one(&mut self, report: Report<C>) {
        match &mut self.inner {
            Some(inner) => inner.extend_one(report),
            inner => *inner = Some(report),
        }
    }

    pub(crate) fn into_result(mut self) -> Result<(), Report<C>> {
        self.bomb.defuse();

        self.inner.map_or_else(|| Ok(()), Err)
    }
}
