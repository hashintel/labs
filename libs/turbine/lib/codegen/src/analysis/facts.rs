use std::collections::HashSet;

use type_system::url::VersionedUrl;

use crate::analysis::unify::LINK_REF;

pub(crate) struct Facts {
    pub(crate) links: HashSet<VersionedUrl>,
}

impl Facts {
    pub(crate) fn new() -> Self {
        Self {
            links: HashSet::new(),
        }
    }

    pub(crate) fn links(&self) -> &HashSet<VersionedUrl> {
        &self.links
    }

    pub(crate) fn should_skip(&self, url: &VersionedUrl) -> bool {
        url == LINK_REF.url()
    }
}
