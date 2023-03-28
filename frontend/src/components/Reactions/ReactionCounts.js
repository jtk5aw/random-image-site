import React from 'react';
import { orderAndFilterReactions } from './dataUtils';
import {getIcon} from './icons';
import '../../App.css';

export const ReactionCounts = ({ currReactionCounts }) => {

  const hasCount = (reaction) => currReactionCounts[reaction] > 0;

  return (
    <div className="Todays-Reaction-Counts">
      {currReactionCounts 
        ? orderAndFilterReactions(Object.keys(currReactionCounts), (reaction) => {
          return (
            <div className={ hasCount(reaction) ? 'Reaction-Count': 'Reaction-No-Count'} key={ reaction }>
              <img className="Small-Icon" src={ getIcon(reaction) } alt={reaction} />
              { hasCount(reaction) ? <div> {currReactionCounts[reaction]} </div> : null }
            </div>
          )
        }) 
        : null}
    </div>
  )
}

ReactionCounts.defaultProps = {
  currReactionCounts: {'NoReaction': '0', 'Funny': '2'}
}

export default ReactionCounts