## How to deploy discord bot

`npx sst deploy`

## Generate secrets with 

openssl rand -base64 2048 > <local-secret-file-name>

Then set them with 

npx sst secret set <secret-name> < <local-secret-file-name>

## Mobile

For some reasong sometimes you have to change the objectversion from 70 to 53 for stuff to compile

:shrug: I have literally zero clue why and haven't been able to look into what the problem is.
But sometimes it just gets autoupdated back to 70 and that just breaks stuff

## Share extension

Making the share extension required downloading xcode, opening the project in xcode, setting up signing capabilitites and then adding a target that is the share extension.

## TODO: Add instructions for other deployments and how to make changes.
## I previously had it in a local file cause it contained secret values 
## but I think I've since lost access to that
