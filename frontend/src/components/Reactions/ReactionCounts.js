import React from 'react';
import { orderAndFilterReactions } from './utils';
import {getIcon} from './icons';
import { MdGrade } from 'react-icons/md';
import '../../App.css';

export const ReactionCounts = ({ currReactionCounts, hasFavorite, onToggleRecentImagesClick }) => {

  const hasCount = (reaction) => currReactionCounts[reaction] > 0;

  return (
    <div className='flex justify-between pl-4 p-2'>
      <div className='flex justify-left'>
        {currReactionCounts 
          ? orderAndFilterReactions(Object.keys(currReactionCounts), (reaction) => {
            return hasCount(reaction) 
              ?
                <div className='flex w-12 h-8 ml-0.5 justify-center justify-items-center rounded-xl bg-red-400 border-red-500 border-2' key={ reaction }>
                  <img className='h-7 w-7' src={ getIcon(reaction) } alt={reaction} />
                  <div> {currReactionCounts[reaction]} </div>
                </div>
              : null;
          }) 
          : null}
      </div>
      <MdGrade 
        onClick={onToggleRecentImagesClick}
        className={ onToggleRecentImagesClick === null 
          ? 'blur-sm' 
          : !hasFavorite 
              ? 'animate-spin-slow' 
              : '' } 
        size={30} /> 
    </div>
  )
}

ReactionCounts.defaultProps = {
  currReactionCounts: {'NoReaction': '0', 'Funny': '2'}
}

export default ReactionCounts