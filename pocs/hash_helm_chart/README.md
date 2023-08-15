# HASH Helm Chart PoC

This is a PoC of using Kubernetes to deploy the HASH backend.
The postgres, redis and search-loader charts are only applied if they have proper connection information.

Postgres is spun up if `pg.host` = `hash-db`
Redis is spun up if `redis.host` = `hash-redis`

## The setup

The system uses NGINX as a load balancer to expose pods outwards.
This allows us to have URL-based routing on a shared NGINX instance.

The pods refer to each other through CoreDNS and K8s Services, which allow for DNS names to resolve to local IPs

The helm chart can be spun up by:

- Having `k3d`, `helm` and `kubectl` installed
- Adding `127.0.0.1  hash.localhost` as a /etc/hosts entry
- Running the following commands:

  ```bash
  $ k3d cluster create --config ./k3d-config.yaml
  $ helm upgrade --install ingress-nginx ingress-nginx --repo https://kubernetes.github.io/ingress-nginx --namespace ingress-nginx --create-namespace
  ```

- Apply the helm chart with `helm install hash ./hash`. Delete with `helm delete hash -n default`
- Running the HASH frontend with `api.hash.localhost` as the API endpoint (this is a little spotty, as we need to proxy the endpoint for CORS not to blow up)
- Going to `http://k8s.hash.localhost` for the k8s dashboard

It is possible to forward the DB port by running `kubectl port-forward service/hash-db 5432:5432`, which exposes it on port 5432 on the host.

Clean up the setup by running

```bash
$ k3d cluster delete hash
```

### Unimplemented

Other than the frontend not being started in the helm chart, the missing pieces are:

- DB migration runner
- OpenSearch instance (this should probably be added, but it's a very memory-intensive container to run)
- Secrets management in k8s
- Environment varibles as ConfigMaps (so we don't need to re-define env vars all over the place)

## Architecture

The Helm chart uses the shared `values.yaml` to define all environment variables and toggles for the setup.
The setup can be roughly depicted as follows

```text
                      ┌─────────────────────┐
            ┌───────► │Kubernetes-dashboard?│   ?=optional
        ┌───┼─────────┴─────────────────────┴───────────┐
        │   │     k8s.                                  │
        │   │                  graph ◄────┐             │
        │   │                             │             │
HTTP ───┤►NGINX                           │             │
        │ingress───────────► Api ◄────────┼── Postgres? │
        │   │     api.                    │             │
        │   │                             │             │
        │   ├──────────────► kratos ◄─────┘             │
        │   │  kratos.                                  │
        │   │                                           │
        │   └──────────────► frontend                   │
        │            .                                  │
        └───────────────────────────────────────────────┘
```

Where the NGINX serves as the reverse proxy for the API and k8s-dashboard.
The external services are optional to run, and run only if a certain hostname is set.

The kubernetes dashboard is mostly for local development, and would not be something we run in production/staging, EKS might already offer it.
The Redis and Postgres pods could also be external services on AWS, along with OpenSearch.

### Building (may be out of date)

```console
$ DOCKER_BUILDKIT=1 docker build ./packages/hash/external-services/postgres -t hash-registry.localhost:5000/hash/hash-postgres:local
$ DOCKER_BUILDKIT=1 docker build ./packages/hash/external-services/kratos --build-arg ENV=prod -t hash-registry.localhost:5000/hash/kratos-prod:local
$ DOCKER_BUILDKIT=1 docker build ./packages/graph -f ./packages/graph/deployment/migrations/Dockerfile -t hash-registry.localhost:5000/hash/hash-graph-migrate-prod:local
$ DOCKER_BUILDKIT=1 docker build ./packages/graph -f ./packages/graph/deployment/graph/Dockerfile -t hash-registry.localhost:5000/hash/hash-graph-prod:local
$ DOCKER_BUILDKIT=1 docker build . -f ./packages/hash/docker/api/prod/Dockerfile -t hash-registry.localhost:5000/hash/hash-api-prod:local
$ DOCKER_BUILDKIT=1 docker build . --build-arg 'FRONTEND_URL=http://hash.localhost' --build-arg 'API_ORIGIN=http://api.hash.localhost' --build-arg 'SYSTEM_USER_PREFERRED_NAME=System User' --build-arg 'SYSTEM_USER_SHORTNAME=system-user' -t hash-registry.localhost:5000/hash/hash-frontend-prod:local -f packages/hash/docker/frontend/prod/Dockerfile

$ docker push hash-registry.localhost:5000/hash/hash-postgres:local
$ docker push hash-registry.localhost:5000/hash/kratos-prod:local
$ docker push hash-registry.localhost:5000/hash/hash-graph-prod:local
$ docker push hash-registry.localhost:5000/hash/hash-graph-migrate-prod:local
$ docker push hash-registry.localhost:5000/hash/hash-api-prod:local
$ docker push hash-registry.localhost:5000/hash/hash-frontend-prod:local

$ helm upgrade hash ./hash --namespace hash --create-namespace -f hash/values.yaml
$ helm install hash ./hash --namespace hash --create-namespace -f hash/values.yaml
$ helm delete hash --namespace hash

$ export KUBECONFIG=$(k3d kubeconfig write hash)
```
