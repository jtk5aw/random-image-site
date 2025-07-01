## How to deploy discord bot

`npx sst deploy`

## Generate secrets with 

openssl rand -base64 2048 > <local-secret-file-name>

Then set them with 

npx sst secret set <secret-name> < <local-secret-file-name>

## Mobile

Location: `packages/mobile-app/`
Share sheet: `packages/mobile-app/ios/shareImages`

NOTE TO SELF: This is in essence an ejected expo app.
I forget if I actually performed the ejection or not (maybe I should if I haven't) but it 100% should be treated like one since I'm puttin gmy own code inside the ios/ directory.
That also means the app.json file is basically dead weight and is doing very little (if anything).
For example the icons it references will not make any difference

For some reasong sometimes you have to change the objectversion from 70 to 53 for stuff to compile

:shrug: I have literally zero clue why and haven't been able to look into what the problem is.
But sometimes it just gets autoupdated back to 70 and that just breaks stuff

**Note**: In order to develop on an actual device the computer you're building on and the actual device will have a ot share a network.
A hotspot counts as a shared network for public spaces.

To run the app: 

1.
`cd packages/mobile-app`

2.
`npx expo run:ios --device` (recommend using actual phone as the device but a simulator will work for basic stuff)

3.
That's it, the app should now be running

To run the share sheet: 

1.
Go into Xcode.

2.
Find a way to navigate to the top level "mobileApp" page.
This is the Xcode page for the actual mobile app.

3.
From there, select the shareImages target.

4.
At this point there should be a way to get this shareSheet as a scheme up on the top bar.

5.
Make sure that the selected device is a real iPhone.
The share sheet just won't work as well on a simulator and isn't worth testing on one.

6.
Once you have that, just press the "play" button over on the right


### Share extension other notes

Making the share extension required downloading xcode, opening the project in xcode, setting up signing capabilitites and then adding a target that is the share extension.

## TODO: Add instructions for other deployments and how to make changes.
## I previously had it in a local file cause it contained secret values 
## but I think I've since lost access to that
## Or really just deprecate as much of the old stuff as possible/move it to sst v3
## I think there's a way to run sst v3 rust lambdas.
## So that would make the lift relatively easy


## General notes

I backed up the old ddb table in the management account.
It's in AWS backups and if I ever want to restore it I can use that
