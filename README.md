# random-image-site
Static react site that displays one random image per day. Backend is API Gateway backed by Rust Lambdas. 

### Where do the images come from? 
The images are uploaded to an S3 bucket. Some images were manually uploaded but the expected way going forwards is to upload them via a Discord Bot. There is a specific discord server and channel that I have set up that when an image is sent it is copied into S3. Once this copy occurs it is eligible to be selected as the random image of the day. Next steps would be allowing the other user of the app to upload images as well by inviting them to the discord server and explaining how the process works. Beyond that there is the potential to maybe make an app to simplify the upload process. 

### What does one image per day mean? 
The first time a call is made to the API endpoint for fetching an image a random one is selected (more on this in a moment)
and then written to a DynamoDB table. Then, the next call will see there is a record for today and will pull that image rather
than selecting another new one. 

Right now this isn't perfect and two calls at once may both try and select an image of the day and then one of those images would "win". 
At first both people would see two different images but on refresh it would become the image that "won" for both of them. This might be fixed
later by picking the next days image in advance so it is guarantted to only happen once. Right now its designed for one person only so not a big deal. 

### How is the image selection random? 
All the objects in the S3 bucket are listed and then one of them is chosen at random. However, it will not allow the same image to be picked twice in a five day period. There will never be repeats that close together. 

### Future Plans
Have some method of removing images from rotation and "archiving" them. Current thought it to start giving a weekly recap or something where the favorite image or any subset of images is selected as best somehow and those stick around. Unsure exacly how it would go but that is the current idea. Either way I think the weekly recap and picking a favorite will be added, even if it doesn't influence "archiving" images in any way. 

Also want to add a mobile app. Want to practice messing with mobile so I think this is a good place to start. Want to get a MacOS environment though to make the IOS app so I'm working on that. 
