use std::{collections::HashMap, fmt, str::FromStr};

use aws_sdk_dynamodb::types::AttributeValue;
use strum::{EnumProperty, IntoEnumIterator, ParseError};
use strum_macros::{EnumIter, EnumProperty, EnumString};

/** Model used to define reactions */
// Note: a string is used instead of a bool because attributes must be strings at time of writing
#[derive(Debug, EnumString, EnumIter, EnumProperty)]
pub enum Reactions {
    NoReaction,
    Funny,
    Love,
    Tough,
    Wow,
    #[strum(props(Deprecated = "is_deprecated"))]
    Eesh,
    #[strum(props(Deprecated = "is_deprecated"))]
    Pain,
}

impl fmt::Display for Reactions {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{:?}", self)
    }
}

impl Reactions {
    pub fn active_reactions() -> Vec<String> {
        Reactions::iter()
            .filter(|reaction| reaction.get_str("Deprecated").is_none())
            .map(|reaction| reaction.to_string())
            .collect()
    }

    pub fn is_active(&self) -> bool {
        self.get_str("Deprecated").is_none()
    }
}

#[derive(Debug)]
pub enum ReactionError {
    ReactionParseError(ParseError),
}

impl From<ParseError> for ReactionError {
    fn from(err: ParseError) -> Self {
        Self::ReactionParseError(err)
    }
}

impl Reactions {
    pub fn build_starting_counts() -> HashMap<String, AttributeValue> {
        let mut starting_counts = HashMap::new();
        for reaction in Reactions::active_reactions() {
            starting_counts.insert(reaction.to_string(), AttributeValue::N("0".to_owned()));
        }

        starting_counts
    }

    pub fn get_reaction(reaction_str: &str) -> Result<Self, ReactionError> {
        Ok(Reactions::from_str(reaction_str)?)
    }
}
