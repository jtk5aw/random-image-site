import React from 'react';
import { orderAndFilterReactions } from './dataUtils';
import {getIcon} from './icons';
import '../../App.css';

export const ReactionCounts = ({ currReactionCounts }) => {

  const hasCount = (reaction) => currReactionCounts[reaction] > 0;

  return (
    <div className='flex justify-left pl-4'>
      {currReactionCounts 
        ? orderAndFilterReactions(Object.keys(currReactionCounts), (reaction) => {
          return hasCount(reaction) 
            ?
              <div className='flex w-12 h-8 justify-center justify-items-center rounded-xl bg-red-400 border-red-500 border-2' key={ reaction }>
                <img className='h-7 w-7' src={ getIcon(reaction) } alt={reaction} />
                <div> {currReactionCounts[reaction]} </div>
              </div>
            : null;
        }) 
        : null}
    </div>
  )
}

ReactionCounts.defaultProps = {
  currReactionCounts: {'NoReaction': '0', 'Funny': '2'}
}

export default ReactionCounts