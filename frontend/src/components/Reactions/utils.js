import _ from 'lodash';

export const orderAndFilterReactions = (reactions, returnFunction) => _.map(
    _.sortBy(
    _.filter(reactions, (reaction) => reaction !== 'NoReaction'), 
    (key) => key), 
    (key) => returnFunction(key)
);

export const hasReacted = (reaction) => reaction !== 'NoReaction';