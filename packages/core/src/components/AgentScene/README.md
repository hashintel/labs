# 3D Environment

We use react-three-fiber to write reactive 3d environment code. State is managed 
by Recoil and passed down to the children components.



# Why the dependencies?
----

## React-three-fiber
react-three-fiber lets us write complex 3d viewer code leveraging react's hooks. While they might
not be the best tools for the job, it drastically simplifies the code to get a fast 3d scene up
and running.


## Drei
Drei is a helper library for react-three-fiber that enables the use of various control schemes.
We primarily use OrbitControls from drei, though there are other interesting utilities
we could take advantage of (stats, shadows, shaders, and billboards)

## Recoil
Recoil is a data-flow-graph state management solution for canvas-style applications. 
Redux turned out to be too slow to manage 3D viewer state - it would constantly evaluate the
selectors and didn't provide a flag for "dangerouslyMutating" data for shared useState.
Recoil lets us mutate transitions in place before committing them. When generating new objects
dynamically, fully immutable datastructures were constantly allocating and the 3d viewer 
ended up being "stuttery." Mutating in-place solved this issue.

N.B. in development mode, [Recoil will leak memory by building a giant window.$recoilDebugStates object](https://github.com/facebookexperimental/Recoil/issues/471#issuecomment-685217406)