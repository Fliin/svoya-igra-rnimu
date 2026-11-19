param([ValidatePattern('^[a-zA-Z0-9_.-]+$')][string]$RepositoryName = 'svoya-igra-rnimu')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
function Check-Exit([string]$Message) { if ($LASTEXITCODE -ne 0) { throw $Message } }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'GitHub CLI (gh) is not installed. Install it from cli.github.com, then run gh auth login.' }
gh auth status
Check-Exit 'Sign in with gh auth login before publishing.'
npm test
Check-Exit 'Tests failed. Publishing stopped.'
$accountName = gh api user --jq .login
Check-Exit 'Could not read the authenticated GitHub account.'
$fullRepositoryName = "$accountName/$RepositoryName"
if (-not (Test-Path -LiteralPath '.git')) { git init -b main; Check-Exit 'Could not initialize repository.' }
$remoteUrl = git remote get-url origin 2>$null
if ($LASTEXITCODE -eq 0) {
  if ($remoteUrl -notin @("https://github.com/$fullRepositoryName.git", "https://github.com/$fullRepositoryName", "git@github.com:$fullRepositoryName.git")) { throw "Origin points to another repository: $remoteUrl. Stopped without changing it." }
} else {
  gh repo create $fullRepositoryName --public --source . --remote origin --description 'Своя игра · РНИМУ — командная викторина, банк вопросов и специальные механики'
  Check-Exit 'Could not create a new public repository. If it already exists, verify it before attaching origin.'
}
git add .
Check-Exit 'Could not stage project files.'
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { git commit -m 'Build Svoya Igra RNIMU with editors, special events, rehearsal and tests'; Check-Exit 'Commit failed. Check local Git author configuration.' }
$pagesInfo = gh api "repos/$fullRepositoryName/pages" 2>$null
if ($LASTEXITCODE -ne 0) {
  gh api "repos/$fullRepositoryName/pages" --method POST -f build_type=workflow
  Check-Exit 'Could not enable GitHub Pages. Check repository administration rights and account plan.'
} else {
  gh api "repos/$fullRepositoryName/pages" --method PUT -f build_type=workflow
  Check-Exit 'Could not select GitHub Actions as the Pages source.'
}
git push -u origin main
Check-Exit 'Push failed.'
$revision = git rev-parse HEAD
$runId = $null
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  $runId = gh run list --repo $fullRepositoryName --workflow pages.yml --commit $revision --json databaseId --jq '.[0].databaseId' 2>$null
  if ($runId) { break }
  Start-Sleep -Seconds 2
}
if (-not $runId) { throw 'Source pushed, but no deployment run appeared. Check the Actions tab; publication is not verified.' }
gh run watch $runId --repo $fullRepositoryName --exit-status
Check-Exit 'Deployment failed. Inspect the Actions run; publication is not verified.'
$publishedUrl = gh api "repos/$fullRepositoryName/pages" --jq .html_url
Check-Exit 'Could not read the published Pages address.'
$siteResponse = Invoke-WebRequest -Uri $publishedUrl
if ($siteResponse.StatusCode -ne 200 -or $siteResponse.Content -notmatch 'Своя игра') { throw 'Deployment run succeeded, but the published app could not be verified.' }
Write-Host "Verified deployment: $publishedUrl"
