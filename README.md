# TP DevOps — TaskFlow

Application de gestion de tâches avec trois services : front Nginx, API Node.js/Express et base PostgreSQL.

## Architecture

```text
                    Navigateur
                        │
          ┌─────────────┴─────────────┐
          │ NodePort 30080 (prod)     │
          │ NodePort 30081 (val)      │
          ▼                           │
   ┌──────────────┐                   │
   │ Front Nginx  │  Service front    │
   └──────┬───────┘                   │
          │ /api/*                    │
          ▼                           │
   ┌──────────────┐                   │
   │ Back Express │  Service back     │
   └──────┬───────┘                   │
          │ 5432                      │
          ▼                           │
   ┌──────────────┐                   │
   │ PostgreSQL   │  Service db + PVC │
   └──────────────┘                   │
```

Le front proxifie `/api` vers le back (`http://back:3000`), qui interroge PostgreSQL (`db:5432`).

## Structure

```text
.
├── .github/
│   └── workflows/
│       ├── 1-ci-dev.yml
│       ├── 2-cd-val.yml
│       └── 3-cd-prod.yml
├── front/
│   ├── Dockerfile
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── nginx.conf
├── back/
│   ├── Dockerfile
│   ├── package.json
│   ├── package-lock.json
│   └── server.js
├── k8s/
│   ├── val/
│   │   ├── db.yaml
│   │   ├── back.yaml
│   │   └── front.yaml
│   └── prod/
│       ├── db.yaml
│       ├── back.yaml
│       └── front.yaml
├── docker-compose.yml
└── README.md
```

## Environnement Dev (local)

Chaque membre lance son propre environnement avec Docker Compose :

```bash
docker compose up -d --build
```

| URL | Description |
| --- | --- |
| http://localhost:8080 | Interface TaskFlow |
| http://localhost:8080/api/health | Santé API + base |
| http://localhost:8080/api/tasks | Liste des tâches |
| localhost:5432 | PostgreSQL (debug) |

```bash
docker compose logs -f back
docker compose down       # conserve les données
docker compose down -v    # supprime aussi la base
```

## Environnements Val et Prod (Kubernetes)

### Prérequis

- Un cluster Kubernetes avec `kubectl` (k3s sur un des postes du groupe).
- Une StorageClass par défaut pour le PVC PostgreSQL (`kubectl get storageclass`).
- Les images poussées sur le Docker Hub commun.

Installation rapide de k3s :

```bash
curl -sfL https://get.k3s.io | sh -
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown "$USER":"$USER" ~/.kube/config
```

### Déploiement manuel

Remplacer `dockerhub-username` par le compte Docker Hub du groupe :

```bash
sed -i 's|dockerhub-username|MON_COMPTE_DOCKERHUB|g' k8s/val/*.yaml k8s/prod/*.yaml
```

Puis créer les namespaces et appliquer les manifestes :

```bash
kubectl create namespace val
kubectl create namespace prod

kubectl apply -f k8s/val/
kubectl apply -f k8s/prod/
```

Vérifier :

```bash
kubectl -n val get pods,svc
kubectl -n prod get pods,svc
```

| Environnement | URL |
| --- | --- |
| Validation | `http://IP_NOEUD:30081` |
| Production | `http://IP_NOEUD:30080` |

> Les mots de passe PostgreSQL (`valpassword`, `prodpassword`) sont définis dans `k8s/val/db.yaml` et `k8s/prod/db.yaml`. À modifier avant un vrai déploiement. Après le premier démarrage, changer le secret ne modifie pas le mot de passe déjà enregistré dans le volume PostgreSQL.

Nettoyage :

```bash
kubectl delete namespace val
kubectl delete namespace prod
```

## CI/CD

| Fichier | Déclencheur | Actions |
| --- | --- | --- |
| `1-ci-dev.yml` | push `dev`, PR vers `dev`/`val`/`main` | lint Docker, vérification Node, validation K8s, build images `:dev` |
| `2-cd-val.yml` | push `val` | build/push `:val`, déploiement namespace `val`, smoke test |
| `3-cd-prod.yml` | push `main` | build/push `:prod` et `:latest`, déploiement namespace `prod`, smoke test |

### Workflow Git

```text
feature/ma-fonctionnalite
        │ PR
        ▼
       dev  ──push──▶ CI : images :dev
        │ PR
        ▼
       val  ──push──▶ CD : images :val + déploiement Val
        │ PR
        ▼
      main  ──push──▶ CD : images :prod + déploiement Prod
```

Chaque membre crée une branche `feature/*` par fonctionnalité, ouvre une Pull Request vers `dev`, puis les changements remontent vers `val` et `main`.

### Configuration GitHub

Secrets à créer dans **Settings → Secrets and variables → Actions** :

| Secret | Rôle |
| --- | --- |
| `DOCKERHUB_USERNAME` | Compte Docker Hub commun |
| `DOCKERHUB_TOKEN` | Token Docker Hub avec droit `Read & Write` |

Runner self-hosted à installer sur le poste qui héberge Kubernetes :

```bash
./config.sh --url https://github.com/ORG/REPO --token TOKEN
sudo ./svc.sh install
sudo ./svc.sh start
```

Le runner doit pouvoir exécuter `kubectl get nodes`. Les dépôts Docker Hub doivent être publics pour que Kubernetes puisse tirer les images.

## API

| Méthode | Route | Description |
| --- | --- | --- |
| GET | `/healthz` | Liveness |
| GET | `/readyz` | Readiness (PostgreSQL) |
| GET | `/api/health` | Santé complète |
| GET | `/api/tasks` | Liste des tâches |
| POST | `/api/tasks` | Créer une tâche |
| PATCH | `/api/tasks/:id` | Modifier une tâche |
| DELETE | `/api/tasks/:id` | Supprimer une tâche |

Exemple :

```bash
curl -X POST http://localhost:8080/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"Déployer en production","priority":"high"}'
```
