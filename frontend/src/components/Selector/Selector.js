import React from 'react'
import _ from 'lodash'
import {getIcon} from './icons';
import '../../App.css';

import SelectorEmoji from './SelectorEmoji'

export const Selector = ({ reactions, onSelect }) => {

  return (
    <div className="Todays-Reaction">
      { _.map(reactions, (reaction) => {
        return (
          <div className="Todays-Icons" key={ reaction }>
            <SelectorEmoji
              icon={ getIcon(reaction) }
              label={ reaction }
              onSelect={ onSelect }
            />
          </div>
        )
      }) }
    </div>
  )
}

Selector.defaultProps = {
  reactions: ['Love', 'Pain','Funny', 'Eesh'],
}

export default Selector