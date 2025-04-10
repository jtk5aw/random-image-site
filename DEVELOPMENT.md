## How to deploy discord bot

`npx sst deploy`

## Generate secrets with 

openssl rand -base64 2048 > <local-secret-file-name>

Then set them with 

npx sst secret set <secret-name> < <local-secret-file-name>

## TODO: Add instructions for other deployments and how to make changes.
## I previously had it in a local file cause it contained secret values 
## but I think I've since lost access to that
