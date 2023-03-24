use std::{fmt, str::FromStr, collections::HashMap};

use aws_sdk_dynamodb::model::AttributeValue;
use strum::{IntoEnumIterator, ParseError};
use strum_macros::{EnumString, EnumIter};

/** Model used to define reactions */
#[derive(Debug, EnumString, EnumIter)]
pub enum Reactions {
    NoReaction,
    Funny,
    Love,
    Eesh,
    Pain,
}

impl fmt::Display for Reactions {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{:?}", self)
    }
}

#[derive(Debug)]
pub enum ReactionError {
    ReactionParseError(ParseError)
}

impl From<ParseError> for ReactionError {
    fn from(err: ParseError) -> Self {
        Self::ReactionParseError(err)
    }
}

impl Reactions {
    pub fn build_starting_counts() -> HashMap<String, AttributeValue> {
        let mut starting_counts = HashMap::new();
        for reaction in Reactions::iter() {
            starting_counts.insert(reaction.to_string(), AttributeValue::N("0".to_owned()));
        };
        starting_counts
    }

    pub fn get_reaction(reaction_str: &str) -> Result<Self, ReactionError> {
        Ok(Reactions::from_str(reaction_str)?)
    }
}
