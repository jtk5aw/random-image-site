//
//  ShareViewController.swift
//  shareImages
//
//  Created by Jackson Kennedy on 4/19/25.
//

import UIKit
import Social
import MobileCoreServices
import UniformTypeIdentifiers

class ShareViewController: SLComposeServiceViewController {
    
    private var imageView: UIImageView?
    private var sharedImage: UIImage?
    
    override func viewDidLoad() {
        super.viewDidLoad()
        
        // Hide the text field
        self.textView.isHidden = true
        self.textView.text = ""
        
        // Set the title for the share sheet
        self.title = "Upload Image"
    }
    
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        
        // Resize the view to be compact
        preferredContentSize = CGSize(width: 300, height: 320)
    }
    
    override func isContentValid() -> Bool {
        // Always valid since we don't need text
        return true
    }
    
    override func didSelectPost() {
        // Add a loading view
        let loadingView = UIView(frame: self.view.bounds)
        loadingView.backgroundColor = UIColor(white: 0, alpha: 0.7)
        
        let activityIndicator = UIActivityIndicatorView(style: .large)
        activityIndicator.center = loadingView.center
        activityIndicator.color = .white
        activityIndicator.startAnimating()
        
        loadingView.addSubview(activityIndicator)
        self.view.addSubview(loadingView)
        
        // Make a test network call to the backend
        let testUrl = "https://zsqsgmp3bajrmuq6tmqm5frzfy0btrtq.lambda-url.us-west-1.on.aws/api/test"
        
        var myMessage = "Network request in progress"
        
        if let url = URL(string: testUrl) {
            var request = URLRequest(url: url)
            request.httpMethod = "GET"
            
            let task = URLSession.shared.dataTask(with: request) { data, response, error in
                // Log the response for debugging
                var isSuccess = false
                
                if let error = error {
                    myMessage = "Network Error: \(error.localizedDescription)"
                    print(myMessage)
                } else if let data = data, let httpResponse = response as? HTTPURLResponse {
                    myMessage = "Response: \(String(data: data, encoding: .utf8) ?? "No data")"
                    print(myMessage)
                    isSuccess = (200...299).contains(httpResponse.statusCode)
                }
                
                // Show result on the main thread
                DispatchQueue.main.async {
                    // Remove loading view
                    loadingView.removeFromSuperview()
                    
                    // Show success or failure alert
                    let alertController = UIAlertController(
                        title: isSuccess ? "Success!" : "Failure!",
                        message: myMessage,
                        preferredStyle: .alert
                    )
                    
                    alertController.addAction(UIAlertAction(title: "OK", style: .default) { _ in
                        // Complete the extension request after user taps OK
                        self.extensionContext!.completeRequest(returningItems: [], completionHandler: nil)
                    })
                    
                    self.present(alertController, animated: true)
                }
            }
            
            task.resume()
        } else {
            // If URL is invalid, still complete the request
            loadingView.removeFromSuperview()
            self.extensionContext!.completeRequest(returningItems: [], completionHandler: nil)
        }
    }
    
    override func configurationItems() -> [Any]! {
        // No configuration options
        return []
    }
}
