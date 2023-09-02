"""
Setup script for the Rust GitHub Actions.

The output of this will be used as arguments for the GitHub Actions matrix.

see: https://docs.github.com/en/actions/using-jobs/using-a-matrix-for-your-jobs
"""

import re
import json
import itertools
import os
import toml

from fnmatch import fnmatch
from pathlib import Path
from pygit2 import Repository, Commit

CWD = Path.cwd()

# All jobs for all crates will run if any of these paths change
ALWAYS_RUN_PATTERNS = [".github/**", ".config/**", ".cargo/**"]

# We only run a subset of configurations for PRs, the rest will only be tested prior merging
IS_PULL_REQUEST_EVENT = "GITHUB_EVENT_NAME" in os.environ and os.environ["GITHUB_EVENT_NAME"] == "pull_request"


def generate_diffs():
    """
    Generates a diff between `HEAD^` and `HEAD`
    """

    repository = Repository(CWD)
    head = repository.head.peel(Commit)
    return repository.diff(head.parents[0], head, context_lines=0)


def find_local_crates():
    """
    Returns all available crates in the workspace.

    If a crate is in a sub-crate of another crate, only the super-crate will be returned because
    the sub-crates will be picked up by `cargo` automatically.
    :return: a list of crate paths
    """
    return [path.relative_to(CWD).parent for path in CWD.rglob("Cargo.toml") if find_toolchain(path.parent)]


def find_toolchain(crate):
    """
    Returns the toolchain for the specified crate.

    The toolchain is determined by the `rust-toolchain.toml` file in the crate's directory or any parent directory
    :param crate: the path to the crate
    :return: the toolchain for the crate
    """
    directory = crate
    root = Path(directory.root)

    while directory != root:
        toolchain_file = directory / "rust-toolchain.toml"
        if toolchain_file.exists():
            toolchain = toml.load(toolchain_file).get("toolchain", {}).get("channel")
            if toolchain:
                return toolchain
        directory = directory.parent

    return None



def filter_parent_crates(crates):
    checked_crates = []
    for crate in crates:
        if not any(path in crate.parents for path in crates):
            checked_crates.append(crate)
    return checked_crates


def filter_for_changed_crates(diffs, crates):
    """
    Returns a list of paths to crates which have changed files

    If a file was changed, which matches `ALWAYS_RUN_PATTERNS`, all crates will be returned
    :param diffs: a list `Diff`s returned from git
    :param crates: a list of paths to crates
    :return: a list of crate paths
    """
    # Check if any changed file matches `ALWAYS_RUN_PATTERNS`
    if any(
        fnmatch(diff.delta.new_file.path, pattern)
        for diff in diffs
        for pattern in ALWAYS_RUN_PATTERNS
    ):
        return crates

    # Get the unique crate paths which have changed files
    return list(
        {
            crate
            for crate in crates
            for diff in diffs
            if fnmatch(diff.delta.new_file.path, f"{crate}/**")
        }
    )


def output_matrix(name, github_output_file, crates, **kwargs):
    """
    Outputs the job matrix for the given crates
    :param name: The name where the list of crates will be stored to be read by GitHub Actions
    :param crates: a list of paths to crates
    """

    crate_names = {}
    for crate in crates:
        with open(
                crate / "Cargo.toml", "r", encoding="UTF-8"
        ) as cargo_toml:
            cargo_toml_obj = toml.loads(cargo_toml.read())
            if "package" in cargo_toml_obj and "name" in cargo_toml_obj["package"]:
                crate_names[crate] = cargo_toml_obj["package"]["name"]
            else:
                crate_names[crate] = str(crate.name.replace("_", "-"))

    available_toolchains = set()
    used_toolchain_combinations = []

    for crate in crates:
        toolchain = find_toolchain(crate)
        available_toolchains.add(toolchain)
        toolchains = [toolchain]

        used_toolchain_combinations.append(
            itertools.product([crate_names[crate]], toolchains, repeat=1)
        )

    available_toolchain_combinations = itertools.product(crate_names.values(), available_toolchains)
    excluded_toolchain_combinations = set(available_toolchain_combinations).difference(
        *used_toolchain_combinations
    )

    matrix = dict(
        name=[crate_names[crate] for crate in crates],
        toolchain=list(available_toolchains),
        **kwargs,
        exclude=[
            dict(name=elem[0], toolchain=elem[1])
            for elem in excluded_toolchain_combinations
        ],
        include=[
            dict(name=crate_names[crate], directory=str(crate))
            for crate in crates
        ],
    )

    if len(matrix["name"]) == 0:
        matrix = {}

    github_output_file.write(f"{name}={json.dumps(matrix)}\n")
    print(f"Job matrix for {name}: {json.dumps(matrix, indent=4)}")


def main():
    diffs = generate_diffs()
    available_crates = find_local_crates()
    changed_crates = filter_for_changed_crates(diffs, available_crates)
    changed_parent_crates = filter_parent_crates(changed_crates)

    github_output_file = open(os.environ["GITHUB_OUTPUT_FILE_PATH"], "w")

    output_matrix("lint", github_output_file, changed_parent_crates)
    if IS_PULL_REQUEST_EVENT:
        output_matrix("test", github_output_file, changed_parent_crates, profile=["dev"])
    else:
        output_matrix("test", github_output_file, changed_parent_crates, profile=["dev", "release"])

    github_output_file.close()


if __name__ == "__main__":
    main()
