//
//  ShareViewController.swift
//  shareImages
//
//  Created (or promopted really) by Jackson Kennedy on 4/19/25.
//

import UIKit
import MobileCoreServices
import UniformTypeIdentifiers
import Security

// TODO: Add a timeout to network calls (or at least a way to cancel) 
// just gets stuck for a while right now 

// TODO: Look into the memory leak in this. It keeps crashing after some amount of time
// and I don't know why. It doesn't seem to be a problem though cause the share extension isn't 
// meant to really keep running it can be restarted every time you want to use it

class ShareViewController: UIViewController {

    private var imageView: UIImageView?
    private var sharedImage: UIImage?
    private var authenticated: Bool = false
    private var accessToken: String?
    private var refreshToken: String?
    private let accessGroup = "7XNW9F5V9P.com.jtken.randomimagesite"
    private var currentLoadingView: UIView?
    private var activeTasks: [URLSessionTask] = []
    
    // Method to read API endpoint from Info.plist
    private func getApiEndpoint() -> String? {
      guard let apiEndpoint = Bundle.main.object(forInfoDictionaryKey: "API_ENDPOINT") as? String else {
            print("No API endpoint found")
            return nil
        }
        print("API endpoint is: \(apiEndpoint)")
        return apiEndpoint
    }
    
    override func viewDidLoad() {
        super.viewDidLoad()
        
        // Check for authentication before showing the UI
        checkAuthentication()
        setupUI()
        retrieveSharedImage()
    }
    
    private func checkAuthentication() {
        // Try to retrieve tokens first
        accessToken = getValueFromKeychain(key: "accessToken")
        refreshToken = getValueFromKeychain(key: "refreshToken")
        
        // If no access token, show "not logged in" message and cancel
        if accessToken != nil {
            authenticated = true 
        } else {
            let alertController = UIAlertController(
                title: "Not Logged In",
                message: "You must be logged in to the Random Image app in order to upload images.",
                preferredStyle: .alert
            )
               
            alertController.addAction(UIAlertAction(title: "OK", style: .default) { [weak self] _ in
                guard let self = self else { return }
                self.extensionContext!.completeRequest(returningItems: [], completionHandler: nil)
            })
                
            self.present(alertController, animated: true)
        }
    }
    
    private func setupUI() {
        view.backgroundColor = .systemBackground
        
        // Set up the navigation bar with Post and Cancel buttons
        let navigationBar = UINavigationBar(frame: CGRect(x: 0, y: 0, width: view.frame.width, height: 44))
        view.addSubview(navigationBar)
        
        let navigationItem = UINavigationItem(title: "Add a new image!")
        
        // Cancel button
        let cancelButton = UIBarButtonItem(barButtonSystemItem: .cancel, target: self, action: #selector(cancelButtonTapped))
        navigationItem.leftBarButtonItem = cancelButton
        
        // Post button
        let postButton = UIBarButtonItem(barButtonSystemItem: .done, target: self, action: #selector(postButtonTapped))
        navigationItem.rightBarButtonItem = postButton
        
        navigationBar.items = [navigationItem]
        
        // Set up the image view
        imageView = UIImageView(frame: CGRect(x: 0, y: 44, width: view.frame.width, height: view.frame.height - 44))
        imageView?.contentMode = .scaleAspectFit
        imageView?.backgroundColor = .systemGray6
        
        if let imageView = imageView {
            view.addSubview(imageView)
        }
    }
    
    private func retrieveSharedImage() {
        // Get the extension context
        guard let extensionContext = extensionContext else { return }
        
        // Find the image attachment in the context
        guard let inputItems = extensionContext.inputItems as? [NSExtensionItem] else { return }
        
        for item in inputItems {
            guard let attachments = item.attachments else { continue }
            
            for provider in attachments {
                // Check for image types
                if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                    provider.loadItem(forTypeIdentifier: UTType.image.identifier, options: nil) { [weak self] (imageURL, error) in
                        guard let self = self else { return }
                        
                        if let error = error {
                            print("Error loading image: \(error.localizedDescription)")
                            return
                        }
                        
                        // Handle different return types
                        if let url = imageURL as? URL {
                            if let imageData = try? Data(contentsOf: url),
                               let image = UIImage(data: imageData) {
                                self.sharedImage = image
                                
                                DispatchQueue.main.async {
                                    self.imageView?.image = image
                                }
                            }
                        } else if let image = imageURL as? UIImage {
                            self.sharedImage = image
                            
                            DispatchQueue.main.async {
                                self.imageView?.image = image
                            }
                        }
                    }
                }
            }
        }
    }
    
    @objc private func cancelButtonTapped() {
        // Cancel any active network tasks and complete the extension request
        cancelAllTasks()
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
    
    @objc private func postButtonTapped() {
        // Show loading indicator
        let loadingView = UIView(frame: self.view.bounds)
        loadingView.backgroundColor = UIColor(white: 0, alpha: 0.7)
        
        let activityIndicator = UIActivityIndicatorView(style: .large)
        activityIndicator.center = loadingView.center
        activityIndicator.color = .white
        activityIndicator.startAnimating()
        
        loadingView.addSubview(activityIndicator)
        self.view.addSubview(loadingView)
        
        // Store reference for cleanup
        currentLoadingView = loadingView
        
        // Clear the display image to free memory during upload
        imageView?.image = nil
        
        // Get presigned URL from backend
        guard let apiEndpoint = getApiEndpoint() else {
            let alertController = UIAlertController(
                title: "Internal failure",
                message: "Failed to start upload",
                preferredStyle: .alert
            )
            
            alertController.addAction(UIAlertAction(title: "OK", style: .default) { [weak self] _ in
                self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
            })
            
            self.present(alertController, animated: true)
            self.removeLoadingView()
            return
        }
        
        let uploadUrl = "\(apiEndpoint)/api/upload/discord"
        
        guard let url = URL(string: uploadUrl), let accessToken = accessToken, let image = sharedImage else {
            let alertController = UIAlertController(
                title: "Internal failure",
                message: "There was an issue processing your request",
                preferredStyle: .alert
            )
            
            alertController.addAction(UIAlertAction(title: "OK", style: .default) { [weak self] _ in
                self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
            })
            
            self.present(alertController, animated: true)
            self.removeLoadingView()
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
         
        // Make the network call with token refresh capability to get presigned URL
        makeNetworkCall(
            request: request,
            accessToken: accessToken,
            refreshToken: refreshToken,
            loadingView: loadingView,
            isRetry: false
        )
    }
    
    // Helper method to remove loading view safely
    private func removeLoadingView() {
        DispatchQueue.main.async { [weak self] in
            self?.currentLoadingView?.removeFromSuperview()
            self?.currentLoadingView = nil
        }
    }
    
    // Helper method to cancel all active network tasks
    private func cancelAllTasks() {
        for task in activeTasks {
            task.cancel()
        }
        activeTasks.removeAll()
    }
    
    // Helper method to display result and complete the extension
    private func completeWithResult(isSuccess: Bool, message: String, loadingView: UIView, failedRefresh: Bool = false) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { 
                // Even if self is nil, try to remove the loading view
                DispatchQueue.main.async {
                    loadingView.removeFromSuperview()
                }
                return 
            }
            
            // Remove loading view
            self.removeLoadingView()
            
            // Delay alert presentation to avoid UI conflicts
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                // Show success or failure alert
                let alertController = UIAlertController(
                    title: isSuccess ? "Success!" : "Failure!",
                    // TODO: Replace this "please login" with an actual redirect to the app someday 
                    message: isSuccess ? "Image uploaded successfully!" : failedRefresh ? "Please login in the app" : "Failed to upload",
                    preferredStyle: .alert
                )
                
                alertController.addAction(UIAlertAction(title: "OK", style: .default) { [weak self] _ in
                    // Complete the extension request after user taps OK
                    self?.cancelAllTasks()
                    self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
                })
                
                self.present(alertController, animated: true)
            }
        }
    }
    
    func getValueFromKeychain(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecAttrService as String: key,
            kSecAttrAccessGroup as String: accessGroup,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecReturnData as String: true
        ]
        
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        
        guard status == errSecSuccess else {
            print("Failed to fetch \(key) from keychain, status code: \(status)")
            return nil
        }
        
        guard let data = result as? Data else {
            print("Failed to convert keychain result to data for \(key)")
            return nil
        }
        
        return String(data: data, encoding: .utf8)
    }
    
    func saveValueToKeychain(key: String, value: String) -> Bool {
        // Convert the string value to data
        guard let valueData = value.data(using: .utf8) else {
            print("Failed to convert value to data")
            return false
        }
        
        // Check if the key already exists
        let existingQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecAttrService as String: key,
            kSecAttrAccessGroup as String: accessGroup
        ]
        
        // First try to delete any existing item
        let deleteStatus = SecItemDelete(existingQuery as CFDictionary)
        print("Delete status \(deleteStatus)")
        
        // Create the query to add the new item
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecAttrService as String: key,
            kSecAttrAccessGroup as String: accessGroup,
            kSecValueData as String: valueData,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
        ]
        
        // Add the item to the keychain
        let status = SecItemAdd(query as CFDictionary, nil)
        
        guard status == errSecSuccess else {
            print("Failed to save \(key) to keychain, status code: \(status)")
            return false
        }
        
        print("Successfully saved \(key) to keychain")
        return true
    }
    
    // Unified method to make network calls with token refresh support
    private func makeNetworkCall(
        request: URLRequest,
        accessToken: String,
        refreshToken: String?,
        loadingView: UIView,
        isRetry: Bool
    ) {
        // Create a copy of the request that we can modify
        var mutableRequest = request
        
        // Add authorization header if we have an access token
        mutableRequest.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        
        let task = URLSession.shared.dataTask(with: mutableRequest) { [weak self] data, response, error in
            guard let self = self else { return }
            
            var message = "Network request in progress"
            var isSuccess = false
            
            if let error = error {
                message = "\(isRetry ? "Retry r" : "R")equest failed: \(error.localizedDescription)"
                print(message)
                self.completeWithResult(isSuccess: false, message: message, loadingView: loadingView)
                return
            }
            
            if let data = data, let httpResponse = response as? HTTPURLResponse {
                let statusCode = httpResponse.statusCode
                
                // If we got a 401 and this is not already a retry attempt, try to refresh the token
                if statusCode == 401, !isRetry, let refreshToken = refreshToken {
                    print("Received 401, attempting to refresh token")
                    self.attemptRefreshToken(
                        refreshToken: refreshToken,
                        originalRequest: mutableRequest,
                        loadingView: loadingView
                    )
                    return
                }
                
                if (200...299).contains(statusCode) {
                    // If successful, try to parse the response to get the presigned URL
                    do {
                        print(data)
                        if let jsonObject = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                           let success = jsonObject["success"] as? Bool,
                           success == true,
                           let value = jsonObject["value"] as? [String: Any],
                           let presignedUrl = value["presignedUrl"] as? String,
                           let remainingUploads = value["remainingUploads"] as? Int {
                            
                            print("Remaining uploads: \(remainingUploads)")
                            
                            // Now upload the image to the presigned URL
                            self.uploadImageToPresignedUrl(
                                presignedUrl: presignedUrl, 
                                remainingUploads: remainingUploads,
                                loadingView: loadingView
                            )
                            return
                        } else {
                            if let raw = String(data: data, encoding: .utf8) {
                                print("--- Raw response start ---\n\(raw)\n--- Raw response end ---")
                            } else {
                                print("⚠️ Couldn't convert data to UTF-8 string; might be wrong encoding.")
                            }
                            message = "Failed to parse response or missing presigned URL"
                            print(message)
                            isSuccess = false
                        }
                    } catch {
                        message = "Failed to parse response: \(error.localizedDescription)"
                        print(message)
                        isSuccess = false
                    }
                } else {
                    message = "\(isRetry ? "Retry r" : "R")esponse: \(String(data: data, encoding: .utf8) ?? "No data")"
                    print(message)
                    isSuccess = false
                }
                
                self.completeWithResult(isSuccess: isSuccess, message: message, loadingView: loadingView)
            }
        }
        
        activeTasks.append(task)
        task.resume()
    }
    
    // Method to upload the image to the presigned URL
    private func uploadImageToPresignedUrl(presignedUrl: String, remainingUploads: Int, loadingView: UIView) {
        guard let presignedURL = URL(string: presignedUrl), let image = sharedImage else {
            completeWithResult(isSuccess: false, message: "Invalid presigned URL or image", loadingView: loadingView)
            return
        }
        
        // Convert image to JPEG data
        guard let imageData = image.jpegData(compressionQuality: 0.8) else {
            completeWithResult(isSuccess: false, message: "Failed to convert image to JPEG", loadingView: loadingView)
            return
        }
        
        // Create upload request
        var uploadRequest = URLRequest(url: presignedURL)
        uploadRequest.httpMethod = "PUT"
        uploadRequest.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        
        // Create upload task
        let uploadTask = URLSession.shared.uploadTask(with: uploadRequest, from: imageData) { [weak self] data, response, error in
            guard let self = self else { return }
            
            if let error = error {
                let message = "Upload failed: \(error.localizedDescription)"
                print(message)
                self.completeWithResult(isSuccess: false, message: message, loadingView: loadingView)
                return
            }
            
            if let httpResponse = response as? HTTPURLResponse {
                let statusCode = httpResponse.statusCode
                let isSuccess = (200...299).contains(statusCode)
                
                if isSuccess {
                    let message = "Image uploaded successfully!"
                    print(message)
                    self.completeWithResult(isSuccess: true, message: message, loadingView: loadingView)
                } else {
                    let responseData = data != nil ? String(data: data!, encoding: .utf8) ?? "No data" : "No data"
                    let message = "Upload failed with status code \(statusCode): \(responseData)"
                    print(message)
                    self.completeWithResult(isSuccess: false, message: message, loadingView: loadingView)
                }
            }
        }
        
        activeTasks.append(uploadTask)
        uploadTask.resume()
    }
    
    // Method to refresh the token and retry the original request
    private func attemptRefreshToken(
        refreshToken: String,
        originalRequest: URLRequest,
        loadingView: UIView
    ) {
        guard let apiEndpoint = getApiEndpoint() else {
            let message = "Failed to start upload"
            completeWithResult(isSuccess: false, message: message, loadingView: loadingView)
            return
        }
        
        guard let refreshURL = URL(string: "\(apiEndpoint)/refresh") else {
            let message = "Cannot create refresh URL"
            completeWithResult(isSuccess: false, message: message, loadingView: loadingView)
            return
        }
        
        var refreshRequest = URLRequest(url: refreshURL)
        refreshRequest.httpMethod = "POST"
        refreshRequest.setValue(refreshToken, forHTTPHeaderField: "refresh_token")
        refreshRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let refreshTask = URLSession.shared.dataTask(with: refreshRequest) { [weak self] data, response, error in
            guard let self = self else { return }
            
            if let error = error {
                let message = "Token refresh failed: \(error.localizedDescription)"
                self.completeWithResult(isSuccess: false, message: message, loadingView: loadingView, failedRefresh: true)
                return
            }
            
            guard let data = data else {
                let message = "Token refresh failed: No data received"
                self.completeWithResult(isSuccess: false, message: message, loadingView: loadingView, failedRefresh: true)
                return
            }
            
            // Try to parse the refresh response
            do {
                if let jsonObject = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let success = jsonObject["success"] as? Bool,
                   success == true,
                   let value = jsonObject["value"] as? [String: Any],
                   let newAccessToken = value["accessToken"] as? String,
                   let newRefreshToken = value["refreshToken"] as? String {
                    
                    // Update the access and refresh tokens
                    print("Token refresh successful, saving to keychain")

                    saveValueToKeychain(key: "accessToken", value: newAccessToken)
                    saveValueToKeychain(key: "refreshToken", value: newRefreshToken)

                    print("Successfully updated keychain, retrying original request")
                    
                    // Retry the original request with the new access token
                    self.makeNetworkCall(
                        request: originalRequest,
                        accessToken: newAccessToken,
                        refreshToken: newRefreshToken,
                        loadingView: loadingView,
                        isRetry: true
                    )
                } else {
                    let responseStr = String(data: data, encoding: .utf8) ?? "Invalid response format"
                    let message = "Token refresh failed: \(responseStr)"
                    self.completeWithResult(isSuccess: false, message: message, loadingView: loadingView, failedRefresh: true)
                }
            } catch {
                let message = "Failed to parse refresh response: \(error.localizedDescription)"
                self.completeWithResult(isSuccess: false, message: message, loadingView: loadingView)
            }
        }
        
        activeTasks.append(refreshTask)
        refreshTask.resume()
    }
    
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        
        // Set a fixed size for the view
        if authenticated {
            self.preferredContentSize = CGSize(width: 300, height: 320)
        } else {
            self.preferredContentSize = CGSize(width: 1, height: 1)
        }
    }
}
