import _ from 'lodash';
import { NO_REACTION } from '../../config/constants';

export const orderAndFilterReactions = (reactions, returnFunction) => _.map(
    _.sortBy(
    _.filter(reactions, (reaction) => reaction !== NO_REACTION), 
    (key) => key), 
    (key) => returnFunction(key)
);

export const hasReacted = (reaction) => reaction !== NO_REACTION;