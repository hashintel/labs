# shared

This folder belongs to the api, and is used to contain files that need to be shared between the API and Core. This
folder is symlinked from the api to core and cannot contain any files (either directly, or via an import) that cannot be
packaged in Core. For that reason, it is recommended that files in this directory **do not import** other files.

The symlink is already contained in the repository and is a relative symlink, so you should not need to do anything to
make it work.

This symlink is in lieu of the api package being a proper package in our monorepo, which would allow direct importing as
we do from `@hashintel/utils`.

Additionally, this folder must belong inside API and not Core because the API's source is available while packaging Core
in Circle-CI, but the inverse is not true – Core's code is not copied into the docker container  running the API.
