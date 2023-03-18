# random-image-site
Static react site that displays one random image per day. Backend is API Gateway backed by Rust Lambdas. 

### Where do the images come from? 
The images are manually uploaded to an S3 bucket. They are not pulled from any sort of API. **Future Plans**: Make it easier to upload images that will be added to the possible pool to be selected from rather than relying on manual bulk uploads to S3. Initially the plan is to do this with a Discord bot. 

### What does one image per day mean? 
The first time a call is made to the API endpoint for fetching an image a random one is selected (more on this in a moment)
and then written to a DynamoDB table. Then, the next call will see there is a record for today and will pull that image rather
than selecting another new one. 

Right now this isn't perfect and two calls at once may both try and select an image of the day and then one of those images would "win". 
At first both people would see two different images but on refresh it would become the image that "won" for both of them. This might be fixed
later, designed for one person only so not a big deal. 

### How is the image selection random? 
All the objects in the S3 bucket are listed and then one of them is chosen at random. However, it will not allow the same image to be picked twice in a five day period. There will never be repeats that close together. **Future Plans:** After an image shows up once (or maybe three times) it will be "archived" and moved out of rotation. It will be kept around though
