import React from 'react';
import {getIcon} from './icons';
import '../../App.css';

import SelectorEmoji from './SelectorEmoji'
import { orderAndFilterReactions } from './dataUtils';

export const Selector = ({ reactions, currReaction, onSelect }) => {

  return (
    <div className='flex justify-center'>
      { orderAndFilterReactions(reactions, (reaction) => {
        return (
          <div className='flex justify-center' key={ reaction }>
            <SelectorEmoji
              selected = { reaction === currReaction }
              icon={ getIcon(reaction) }
              label={ reaction }
              onSelect={ onSelect }
            />
          </div>
        )
      })}
    </div>
  )
}

Selector.defaultProps = {
  reactions: ['Love', 'Tough','Funny', 'Wow'],
}

export default Selector