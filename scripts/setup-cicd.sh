#!/usr/bin/env bash
# GitHub Actions から Firebase へキーなしでデプロイするための初期設定。1 回だけ実行する。
set -euo pipefail

PROJECT_ID=konbu-devfest-hackathon-2026
PROJECT_NUMBER=1032832330557
REPO=Lazyturtle0852/konbu-devfest
POOL=github
PROVIDER=konbu-devfest
DEPLOY_SA="github-deploy@${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud iam service-accounts create github-deploy \
  --project "$PROJECT_ID" --display-name "GitHub Actions deploy"

for role in \
  roles/firebase.admin \
  roles/firebaserules.admin \
  roles/datastore.indexAdmin \
  roles/cloudfunctions.admin \
  roles/run.admin \
  roles/cloudbuild.builds.editor \
  roles/artifactregistry.admin \
  roles/iam.serviceAccountUser \
  roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member "serviceAccount:${DEPLOY_SA}" --role "$role" \
    --condition None --quiet --format none
done

gcloud iam workload-identity-pools create "$POOL" \
  --project "$PROJECT_ID" --location global --display-name "GitHub Actions"

# このリポジトリの deploy ブランチからの実行だけを受け付ける（本番へ出すのは人が deploy へ反映したときだけ。
# todo/humans/2026-11-07-deploy-branch.md）。作ったあとに変えるときは、create-oidc を update-oidc にして
# --attribute-condition だけを渡す（docs/process/setup.md「本番への反映」）
gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
  --project "$PROJECT_ID" --location global --workload-identity-pool "$POOL" \
  --issuer-uri https://token.actions.githubusercontent.com \
  --attribute-mapping 'google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref' \
  --attribute-condition "assertion.repository == '${REPO}' && assertion.ref == 'refs/heads/deploy'"

gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" \
  --project "$PROJECT_ID" --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${REPO}" \
  --format none

# Functions から Vertex AI を呼ぶための権限
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member "serviceAccount:${RUNTIME_SA}" --role roles/aiplatform.user \
  --condition None --quiet --format none

# 古いビルド成果物を 7 日で消す（デプロイ時の確認で止まらないように）
firebase functions:artifacts:setpolicy \
  --project "$PROJECT_ID" --location asia-northeast1 --days 7 --force

echo "設定が完了しました"
