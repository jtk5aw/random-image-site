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

class ShareViewController: UIViewController {

    private var imageView: UIImageView?
    private var sharedImage: UIImage?
    private var authenticated: Bool = false
    private var accessToken: String?
    private var refreshToken: String?
    private let accessGroup = "7XNW9F5V9P.com.jtken.randomimagesite"
    
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
        // Complete the extension request - cancel
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
        
        // Make a test network call to the backend
        let testUrl = "https://jacksonkennedy.mobile.jtken.com/api/test"

        guard let url = URL(string: testUrl), let accessToken = accessToken else {
            let alertController = UIAlertController(
                title: "Internal failure",
                message: "There was an issue processing your request",
                preferredStyle: .alert
            )
            
            alertController.addAction(UIAlertAction(title: "OK", style: .default) { _ in
                self.extensionContext!.completeRequest(returningItems: [], completionHandler: nil)
            })
            
            self.present(alertController, animated: true)
            loadingView.removeFromSuperview()
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
         
        // Make the network call with token refresh capability
        makeNetworkCall(
            request: request,
            accessToken: accessToken,
            refreshToken: refreshToken,
            loadingView: loadingView,
            isRetry: false
        )
    }
    
    // Helper method to display result and complete the extension
    private func completeWithResult(isSuccess: Bool, message: String, loadingView: UIView) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            
            // Remove loading view
            loadingView.removeFromSuperview()
            
            // Show success or failure alert
            let alertController = UIAlertController(
                title: isSuccess ? "Success!" : "Failure!",
                message: isSuccess ? "Upload complete" : "Failed to upload",
                preferredStyle: .alert
            )
            
            alertController.addAction(UIAlertAction(title: "OK", style: .default) { _ in
                // Complete the extension request after user taps OK
                self.extensionContext!.completeRequest(returningItems: [], completionHandler: nil)
            })
            
            self.present(alertController, animated: true)
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
                
                message = "\(isRetry ? "Retry r" : "R")esponse: \(String(data: data, encoding: .utf8) ?? "No data")"
                print(message)
                isSuccess = (200...299).contains(statusCode)
                self.completeWithResult(isSuccess: isSuccess, message: message, loadingView: loadingView)
            }
        }
        
        task.resume()
    }
    
    // Method to refresh the token and retry the original request
    private func attemptRefreshToken(
        refreshToken: String,
        originalRequest: URLRequest,
        loadingView: UIView
    ) {
        guard let refreshURL = URL(string: "https://jacksonkennedy.mobile.jtken.com/refresh") else {
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
                self.completeWithResult(isSuccess: false, message: message, loadingView: loadingView)
                return
            }
            
            guard let data = data else {
                let message = "Token refresh failed: No data received"
                self.completeWithResult(isSuccess: false, message: message, loadingView: loadingView)
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
                    self.completeWithResult(isSuccess: false, message: message, loadingView: loadingView)
                }
            } catch {
                let message = "Failed to parse refresh response: \(error.localizedDescription)"
                self.completeWithResult(isSuccess: false, message: message, loadingView: loadingView)
            }
        }
        
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
