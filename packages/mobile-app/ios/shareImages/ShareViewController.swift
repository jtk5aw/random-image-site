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
import Security

class ShareViewController: SLComposeServiceViewController {
   
   // TODO TODO TODO: Got it working!!! woot woot. 
   // Next steps are to set up refresh here (if creds are old when this call is made it just fails)
   // and also clean up some of the logging (especially reading back the access token)

    private var imageView: UIImageView?
    private var sharedImage: UIImage?
    private var accessToken: String?
    private var refreshToken: String?
    private let accessGroup = "7XNW9F5V9P.com.jtken.randomimagesite"
    private var testKeyValue: String?
    
    override func viewDidLoad() {
        super.viewDidLoad()
        
        // Hide the text field
        self.textView.isHidden = true
        self.textView.text = ""
        
        // Set the title for the share sheet
        self.title = "Upload Image"
        
        // Retrieve tokens from keychain
        retrieveTokensFromKeychain()
    }
    
    func retrieveTokensFromKeychain() {
        accessToken = getValueFromKeychain(key: "accessToken")
        refreshToken = getValueFromKeychain(key: "refreshToken")
        
        // Print the tokens to console for debugging
        print("Access Token: \(accessToken ?? "Not found")")
        print("Refresh Token: \(refreshToken ?? "Not found")")
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
        print("This is a test of  mine at the start of save")
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
        
        // Write a test value to the keychain
        let testKey = "shareExtensionTestKey"
        let testValue = "Test value from share extension: \(Date())"
        let saveSuccess = saveValueToKeychain(key: testKey, value: testValue)
        
        // Read the value back from the keychain
        let retrievedValue = getValueFromKeychain(key: testKey)
        
        // Display token and keychain test information
        let keychainTestInfo = """
        Write to keychain: \(saveSuccess ? "Success" : "Failed")
        Written value: \(testValue)
        Retrieved value: \(retrievedValue ?? "Not found")
        """
        
        let tokenInfo = """
        Access Token: \(accessToken ?? "Not found")
        Refresh Token: \(refreshToken ?? "Not found")
        
        \(keychainTestInfo)
        """
        print(tokenInfo)
        
        // Make a test network call to the backend
        let testUrl = "https://jacksonkennedy.mobile.jtken.com/api/test"
        
        var myMessage = "Network request in progress"
        
        if let url = URL(string: testUrl) {
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            
            // Add authorization header if we have an access token
            if let accessToken = self.accessToken {
                request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
            }
            
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
                
                // Add token info and keychain test info to message
                myMessage += "\n\n" + tokenInfo
                
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
            // If URL is invalid, show tokens and keychain test info and complete the request
            let alertController = UIAlertController(
                title: "Token and Keychain Information",
                message: tokenInfo,
                preferredStyle: .alert
            )
            
            alertController.addAction(UIAlertAction(title: "OK", style: .default) { _ in
                self.extensionContext!.completeRequest(returningItems: [], completionHandler: nil)
            })
            
            self.present(alertController, animated: true)
            loadingView.removeFromSuperview()
        }
    }
    
    override func configurationItems() -> [Any]! {
        // No configuration options
        return []
    }
}
