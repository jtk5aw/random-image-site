use std::collections::HashMap;

use aws_sdk_dynamodb::{Client, types::{AttributeValue, ReturnValue}};
use log::{info, warn, error};

use crate::{aws_sdk::{DynamoDbUtil, DynamoDbUtilError, KeyAndAttribute, KeyAndAttributeName}, models::{Reactions, ReactionError}};

pub struct UserReactionDao<'a> {
    pub table_name: &'a str,
    pub primary_key: &'a str,
    pub sort_key: &'a str,
    pub dynamodb_client: &'a Client
}

#[derive(Debug)]
pub enum UserReactionDaoError {
    DynamoDbError(DynamoDbUtilError),
    AttributeValueParsingError(AttributeValue),
    ReactionConversionError(ReactionError),
    ManualError(String)
}

impl From<DynamoDbUtilError> for UserReactionDaoError {
    fn from(err: DynamoDbUtilError) -> Self {
        Self::DynamoDbError(err)
    }
}

impl From<AttributeValue> for UserReactionDaoError {
    fn from(err: AttributeValue) -> Self {
        Self::AttributeValueParsingError(err)
    }
}

impl From<ReactionError> for UserReactionDaoError {
    fn from(err: ReactionError) -> Self {
        Self::ReactionConversionError(err)
    }
}

impl From<String> for UserReactionDaoError {
    fn from(err: String) -> Self {
        Self::ManualError(err)
    }
}

const REACTION_COUNTS: &str = "ReactionCounts";

impl UserReactionDao<'_> {

    ///
    /// Returns the reaction for the provided date and uuid. 
    /// 
    /// # Arguments
    /// 
    /// * `today_as_string` - Date represented as a string in the format 'YYYY-MM-DD'
    /// * `curr_uuid` - The UUID associated with the current user making a request
    /// 
    /// # Result
    /// * String` - No errors can be thrown. Will either return the fetched string or return a default Reactions::NoReaction
    pub async fn get_reaction(
        &self,
        today_as_string: &str,
        curr_uuid: &str
    ) -> String {
        let keys_and_attributes = self.build_user_reaction_key_and_attribute(
            today_as_string,
            curr_uuid,
        );
    
        let get_item_from_key_result = self.dynamodb_client
            .get_item_from_keys(self.table_name, keys_and_attributes)
            .await
            .ok();
    
        match get_item_from_key_result {
            Some(dynamo_map) => {
                dynamo_map
                    .get("reaction")
                    .map_or(Reactions::NoReaction.to_string(), |reaction_val| {
                        reaction_val
                            .as_s()
                            .map_or(Reactions::NoReaction.to_string(), |result| {
                                result.to_owned()
                            })
                    })
            }
            None => Reactions::NoReaction.to_string(),
        }
    }

    ///
    /// Given a date, uuid, and reaction it will set the provided users reaction on the provided
    /// date. This will overwrite the previous reaction if it exists and return the old reaction as
    /// a string. 
    /// 
    /// Also will only write the reaction if it is a current active reaction. Any deprecated reactions
    /// will be ignored
    /// 
    /// # Arguments
    /// * `today_as_string` - The date as a string "YYYY-MM-DD"
    /// * `curr_uuid` - The Users UUID
    /// * `new_reaction` - The reaction as a string that is being set. 
    ///
    /// # Returns
    /// * `Ok(String)` - Returns the old reaction as a string. If none exists, returns Reactions::NoReaction
    /// * `Error(UserReactionDaoError) - Propagates an unexpted error from calling DynamoDB. 
    /// 
    pub async fn set_reaction(
        &self,
        today_as_string: &str,
        curr_uuid: &str,
        new_reaction: &Reactions,
    ) -> Result<Reactions, UserReactionDaoError> {
        // Return an error if the provided reaction is deprecated
        new_reaction.is_active().then_some(()).ok_or("The provided reaction is deprecated".to_owned())?;

        let keys_and_attributes = self.build_user_reaction_key_and_attribute(
            today_as_string,
            curr_uuid,
        );
    
        let expression_attribute_values = vec![KeyAndAttribute {
            key: ":new_reaction",
            attribute: AttributeValue::S(new_reaction.to_string()),
        }];
    
        // Updates the reaction
        // Gets the old reaction. This allows for decrementing the old reaction count
        let update_reaction_result = self.dynamodb_client
            .update_item_with_keys(
                self.table_name,
                keys_and_attributes,
                "SET reaction = :new_reaction".to_owned(),
                ReturnValue::AllOld,
                None,
                expression_attribute_values,
            )
            .await;
    
        
        let old_reaction = match update_reaction_result { 
            Ok(result) => Self::handle_old_reaction_success(result), 
            Err(err) => Self::handle_old_reaction_error(err)
        }?;

        Ok(Reactions::get_reaction(&old_reaction)?)
    }

    ///
    /// Helper function for put_reaction
    /// 
    fn handle_old_reaction_success(
        result: HashMap<String, AttributeValue>
    ) -> Result<String, UserReactionDaoError> {
        info!("Request to update reaction completed successfully");

        let reaction = result
            .get("reaction")
            .ok_or_else(|| "Did not successfully write reaction".to_owned())?
            .as_s()
            .map_err(|err| err.to_owned())?;

        Ok(reaction.to_owned())
    }

    /// 
    /// Helper Function for put_reaction
    /// 
    fn handle_old_reaction_error(
        err: DynamoDbUtilError
    ) -> Result<String, UserReactionDaoError> {
        warn!("There was an error attempting to update the reaction");

        if let DynamoDbUtilError::LocalError(_) = err {
            info!("Error only caused because this was the first reaction. Continuing");

            return Ok(Reactions::NoReaction.to_string())
        }

        error!("Error was a failure to update the previous reaction");
        Err(UserReactionDaoError::DynamoDbError(err))
    }

    ///
    /// Sets up the current "ReactionCounts" record if it does not already exist. 
    /// 
    /// # Arguments
    /// *`today_as_string` - A date represented as a string "YYYY-MM-DD"
    /// 
    /// # Returns
    /// * `Ok(()) - As long as no error occurs will just return the unit type
    /// * `Error(UserReactionDaoError)` - Wraps any error that occurs making DynamoDB calls
    /// 
    pub async fn setup_counts(
        &self,
        today_as_string: &str,
    ) -> Result<(), UserReactionDaoError> {
        let counts_keys_and_attributes = self.build_user_reaction_key_and_attribute(
            today_as_string,
            REACTION_COUNTS,
        );
    
        let starting_counts_map = Reactions::build_starting_counts();
    
        let counts_setup_attribute_values = vec![
            KeyAndAttribute {
                key: ":counts_map",
                attribute: AttributeValue::M(starting_counts_map)
            }
        ];
    
        let _update_counts_result = self.dynamodb_client.update_item_with_keys(
            self.table_name,
            counts_keys_and_attributes,
            "SET Counts = if_not_exists(Counts, :counts_map)".to_owned(),
            ReturnValue::AllNew,
            None,
            counts_setup_attribute_values
    
        ).await?;

        Ok(())
    }

    ///
    /// Gets the current counts of all reactions that have been made. 
    /// 
    /// # Arguments
    /// * `today_as_string` - Date represented as a string in the format 'YYYY-MM-DD'
    /// 
    /// # Result
    /// * `Ok(HashMap<String, String>)` - Returns a HashMap where key is the reaction string and value is the number of times its been "reacted"
    /// * `Error(UserReactionDaoError)` - Any error that occurs while trying to get the current counts
    /// 
    pub async fn get_counts(
        &self,
        today_as_string: &str,
    ) -> Result<HashMap<String, String>, UserReactionDaoError> {
        let keys_and_attributes = self.build_user_reaction_key_and_attribute(
            today_as_string,
            REACTION_COUNTS,
        );
    
        let get_counts_result = self.dynamodb_client.get_item_from_keys(
            self.table_name, 
            keys_and_attributes
        ).await?;
    
        let counts = get_counts_result
            .get("Counts")
            .ok_or_else(|| "Did not successfully get counts".to_owned())?
            .as_m()
            .map_err(|err| err.to_owned())?;
    
        info!("Request to retrieve counts completed");
    
        Ok(generate_numeric_counts(counts))
    }

    ///
    /// Given a date as well as old and new reactions, update count totals as necessary. 
    /// If the reactions are the same this means doing nothing. If they're different this means 
    /// incrementing and decrementing the new and old reaction counts respectively. 
    /// 
    /// # Arguments
    /// * `today_as_string` - String representing the date being updated as "YYYY-MM-DD"
    /// * `old_reaction` - The old reaction that was changed
    /// * `new_reaction` - The new reaction that has been set
    /// 
    /// # Returns
    /// * `Ok(HashMap<String, String>)` - Returns a HashMap where key is the reaction string and value is the number of times its been "reacted"
    /// * `Error(UserReactionDaoError)` - Any failure that occurs while trying to update/get the counts
    /// 
    pub async fn update_counts(
        &self,
        today_as_string: &str,
        old_reaction: &Reactions,
        new_reaction: &Reactions
    ) -> Result<HashMap<String, String>, UserReactionDaoError> {
        let old_reaction_str = old_reaction.to_string();
        let new_reaction_str = new_reaction.to_string();

        // If the reactions are the same, return early
        if old_reaction_str == new_reaction_str {
            let curr_counts = self.get_counts(
                today_as_string
            ).await?;
            return Ok(curr_counts);
        }

        // Otherwise, update counts as necessary
        let counts_keys_and_attributes = self.build_user_reaction_key_and_attribute(
            today_as_string,
            REACTION_COUNTS,
        );
    
        let counts_expression_attribute_names = Some(vec![
            KeyAndAttributeName {
                key: "#new_reaction",
                attribute_name: &new_reaction_str,
            },
            KeyAndAttributeName {
                key: "#old_reaction",
                attribute_name: &old_reaction_str,
            },
        ]);
    
        let counts_expression_attribute_values = vec![
            KeyAndAttribute {
                key: ":count",
                attribute: AttributeValue::N("1".to_owned()),
            }
        ];
        
        let update_counts_result = self.dynamodb_client.update_item_with_keys(
            self.table_name,
            counts_keys_and_attributes,
            "SET Counts.#new_reaction = Counts.#new_reaction + :count , Counts.#old_reaction = Counts.#old_reaction - :count".to_owned(),
            ReturnValue::AllNew,
            counts_expression_attribute_names,
            counts_expression_attribute_values
    
        ).await?;
    
        info!("Request to update counts completed");
    
        let updated_counts = update_counts_result
            .get("Counts")
            .ok_or_else(|| "Did not successfully update counts".to_owned())?
            .as_m()
            .map_err(|err| err.to_owned())?;
    
        Ok(generate_numeric_counts(updated_counts))
    }

    /** Helper Functions that require state */

    fn build_user_reaction_key_and_attribute(
        &self,
        today_as_string: &str,
        user: &str,
    ) -> Vec<KeyAndAttribute> {
        vec![
            KeyAndAttribute {
                key: self.primary_key,
                attribute: AttributeValue::S(today_as_string.to_owned()),
            },
            KeyAndAttribute {
                key: self.sort_key,
                attribute: AttributeValue::S(user.to_owned()),
            },
        ]
    }   

}

/** Generate helper functions that don't require state */
fn generate_numeric_counts(
    retrieved_counts: &HashMap<String, AttributeValue>
) -> HashMap<String, String> {
    let mut numeric_counts: HashMap<String, String> = HashMap::default();
    for (key, value) in retrieved_counts {
        let count = value
            .as_n()
            .map_or(
                "0".to_owned(), 
                |val| val.to_owned()
            );
        numeric_counts.insert(key.to_owned(), count);
    }
    numeric_counts
}