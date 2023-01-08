# random-image-site
Static react site that displays one random image per day. Backend is API Gateway backed by Rust Lambdas. 

### Where do the images come from? 
The images are manually uploaded to an S3 bucket. They are not pulled from any sort of API. 

### What does one image per day mean? 
The first time a call is made to the API endpoint for fetching an image a random one is selected (more on this in a moment)
and then written to a DynamoDB table. Then, the next call will see there is a record for today and will pull that image rather
than selecting another new one. 

Right now this isn't perfect and two calls at once may both try and select an image of the day and then one of those images would "win". 
At first both people would see two different images but on refresh it would become the image that "won" for both of them. This might be fixed
later, designed for one person only so not a big deal. 

### How is the image selection random? 
All the objects in the S3 bucket are listed and then one of them is chosen at random. There are plans to make this work in such a way that the same image
can't be chosen for N days after it was already chosen but this hasn't been done yet. 
