export { getPyodideLoader } from "./pyodide";
export * from "./wrappers";

// The globals don't exist when pyodide is built, so we need to run this first
export const pyodideInitialize = `
global pythonDatasetCache
global pyStateWrapper
global pyStateCache
global pyContextWrapper
global simGlobals
global pystdlibSource
global currentStep
`;

export const loadPystdlib = `
# Stdlib support
# https://github.com/iodide-project/pyodide/issues/419
import sys
sys.path.insert(0, '.')
with open("hash_stdlib.py", "w") as fd:
    fd.write(pystdlibSource)
`;

export const pyodideWrapperInit = `
from collections.abc import MutableMapping
import json
import copy
import pyodide


class neighborwrapper(MutableMapping):
    def __init__(self, id):
        self.store = dict()
        self.store[self.__keytransform__("agent_id")] = id

    def __getitem__(self, key):
        if(not key in self.store):
            self.store[key] = json.loads(
                pyContextWrapper.getNeighborKey(self.__getitem__("agent_id"), key))
        return self.store[self.__keytransform__(key)]

    def __setitem__(self, key, value):
        raise Exception("Please don't try and set neighbor fields")

    def __delitem__(self, key):
        del self.store[self.__keytransform__(key)]

    def __iter__(self):
        return iter(self.store)

    def __len__(self):
        return len(self.store)

    def __keytransform__(self, key):
        return key


class keywrapper(MutableMapping):
    def __init__(self, backing):
        self.store = dict()
        self.backing = backing

    def __getitem__(self, key):
        if(not key in self.store):
            self.store[key] = convertList(backing[key])
        return self.store[key]

    def __setitem__(self, key, value):
        raise Exception("Use state.set to set state keys")

    def __delitem__(self, key):
        del self.store[self.__keytransform__(key)]

    def __iter__(self):
        return iter(self.store)

    def __len__(self):
        return len(self.store)

    def __keytransform__(self, key):
        return key


class contextwrapper:
    def __init__(self):
        global simGlobals
        self.neighbor_cache = [-1, {}]
        self.globalsDict = json.loads(simGlobals)

    def globals(self):
        global updateGlobals
        if updateGlobals:
            self.globalsDict = json.loads(simGlobals)
            updateGlobals = False
        return self.globalsDict

    def neighbors(self):
        if (self.neighbor_cache[0] < currentStep):
            self.neighbor_cache = [currentStep, {}]
        neighborIds = pyContextWrapper.neighbors()
        neighborsToGet = list(
            filter(lambda n: not n in self.neighbor_cache[1], neighborIds))

        for id in neighborsToGet:
            self.neighbor_cache[1][id] = neighborwrapper(id)

        return list(map(lambda n: self.neighbor_cache[1][n], neighborIds))

    def messages(self):
        return pyContextWrapper.messages().to_py()

    def data(self):
        return cached_datasets

    def step(self):
        return pyContextWrapper.step()


class initcontextwrapper:
    def __init__(self):
        global simGlobals
        self.globalsDict = json.loads(simGlobals)

    def globals(self):
        global updateGlobals
        if updateGlobals:
            self.globalsDict = json.loads(simGlobals)
            updateGlobals = False
        return self.globalsDict

    def data(self):
        return cached_datasets


# Store datasets in a set so they don't get copied on move
if 'cached_datasets' in globals():
    pass
else:
    global cached_datasets
    cached_datasets = {}

# Separate the dataset names from the data so it's cheap to check if a dataset exists
if 'cached_dataset_names' in globals():
    pass
else:
    global cached_dataset_names
    cached_dataset_names = []

jsProxyAttrs = [
    "constructor",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toLocaleString",
    "toString",
    "valueOf",
]


def convertList(item):
    if "findIndex" in dir(item):
        try:
            return list(map(lambda x: convertList(x), item))
        except Exception:
            return item
    elif hasattr(item, "__proto__"):
        return keywrapper(item)
    else:
        return item


class statewrapper:
    def __getitem__(self, key):
        return self.__getattr__(key)

    def __getattr__(self, key):
        if key in pyStateCache:
            return pyStateCache[key]
        else:
            value = json.loads(pyStateWrapper.get(key))
            pyStateCache[key] = value
            return value

    def __setitem__(self, key, value):
        self.__setattr__(key, value)

    def __setattr__(self, key, value):
        pyStateCache[key] = value

    def get(self, *args):
        if(len(args) != 1):
            raise Exception("state.get only takes in a key argument")

        if args[0] in pyStateCache:
            return copy.deepcopy(pyStateCache[args[0]])
        else:
            value = json.loads(pyStateWrapper.get(args[0]))
            pyStateCache[args[0]] = value
            return copy.deepcopy(value)

    def set(self, *args):
        if(len(args) != 2):
            raise Exception(
                "state.set only takes in a key argument and a value argument")
        pyStateCache[args[0]] = copy.deepcopy(args[1])
        return True

    def add_message(self, to, messagetype, data = None):
        messages = pyStateCache.get("messages", None)
        if (messages is None):
            # Save time by not loading all messages into cache
            return pyStateWrapper.add_message(to, messagetype, pyodide.to_js(data))
        else:
            messages.push({"to": [to], "type": messagetype, "data": pyodide.to_js(data)})
            return True

    def behavior_index(self):
        return pyStateWrapper.behavior_index()

    def modify(self, key, lam):
        """
        Modifies a field on agent state by executing a lambda or modification function
        """
        self.set(key, lam(self.get(key)))


contextWrapperInstance = contextwrapper()

initContextWrapperInstance = initcontextwrapper()


def wrap(behavior):
    def wrapped():
        global pyStateCache
        pyStateCache = {}
        state = statewrapper()
        behavior(state, contextWrapperInstance)

        # Flush the cache into the state
        for key, value in pyStateCache.items():
            pyStateWrapper.set(key, pyodide.to_js(value))

        pyStateCache = {}

    return wrapped


def wrap_init(init):
    def wrapped():
        return init(initContextWrapperInstance)
    return wrapped
`;
