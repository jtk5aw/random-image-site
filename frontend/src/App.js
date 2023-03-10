import heart from './HUMAN_HEART.svg';
import { TODAYS_IMAGE_ENDPOINT, TODAYS_METADATA_ENDPOINT } from './config/api';
import './App.css';

import axios from 'axios';
import React, { useState, useEffect } from 'react';
import Selector from './components/Selector/Selector';


function App() {
  const [base64ImageString, setBase64ImageString] = useState('');
  const [showImage, setShowImage] = useState(false);
  const [currReaction, setCurrReaction] = useState('NoReaction');

  // Fetch the current image
  useEffect(() => {
    axios.get(TODAYS_IMAGE_ENDPOINT)
    .then(res => {
        const returnedString = res.data;
        setBase64ImageString(returnedString);
      })
  }, [])

  // Fetch the current metadata
  useEffect(() => {
    axios.get(TODAYS_METADATA_ENDPOINT)
    .then(res => {
      const returnedString = res.data;
      setCurrReaction(returnedString);
    })
  }, [])

  // Start showing the image
  const onClick = () => setShowImage(true);

  // On emoji press, update the reaction
  const onEmojiClick = (reaction) => {
    axios.put(TODAYS_METADATA_ENDPOINT, {'reaction': reaction})
    .then(res => {
      // Means the put was successful
      setCurrReaction(reaction)
    })
  }

  return (
    <div className="App">
      <div className="Title-Header" onClick={onClick}> 
        <img src={heart} className="Header-Image" alt="Human heart" />
        <p>
          Click only if you're Maeov. No one else click 😡
        </p>
      </div>
      { showImage 
        ? <AppBody 
            imageString={base64ImageString} 
            currReaction={currReaction}
            onEmojiClick={onEmojiClick} /> 
        : null }
    </div>
  );
}

const AppBody = ({imageString, currReaction, onEmojiClick}) => (
  <div className="App-Body">
      {
        imageString === '' 
          ? <Loading /> 
          : <Successful 
              imageString={imageString}
              currReaction={currReaction}
              onEmojiClick={onEmojiClick} />
      }
  </div>
);

const Successful = ({imageString, currReaction, onEmojiClick}) => {
  return <div>
    <img src={`data:image/jpg;base64,${imageString}`} className="Todays-Image" alt="todays pic" />
    <Selector currReaction={currReaction} onSelect={onEmojiClick} />
    <p className="Todays-Text">
      Here is todays specially selected image 😎
      I hope you like this one and I hope you come back tomorrow for another one. 
    </p>
  </div>
}

const Loading = ({props}) => {
  return <div class="lds-roller"><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div></div>
}

export default App;
