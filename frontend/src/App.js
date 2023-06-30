import heart from './HUMAN_HEART-cropped.svg';
import { TODAYS_IMAGE_ENDPOINT, TODAYS_METADATA_ENDPOINT } from './config/api';
import './App.css';

import axios from 'axios';
import React, { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from 'react-query';
import Selector from './components/Reactions/Selector';
import ReactionCounts from './components/Reactions/ReactionCounts';

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient} >
      <Page />
    </QueryClientProvider>
  )
}

function Page() {
  // Fetch the current image
  const todaysImageResponse = useQuery({
    queryKey: ['imageUrl'],
    queryFn: () =>
      axios.get(TODAYS_IMAGE_ENDPOINT)
        .then((res) => res.data.url)
  });

  // Fetch todays metadata
  const todaysMetadataResponse = useQuery({
    queryKey: ['metadata'],
    retry: false,
    queryFn: () =>
      axios.get(TODAYS_METADATA_ENDPOINT, { 
        params : { 
          uuid: localStorage.getItem('uuid') 
        } 
      }).then((res) => res.data)
  });

  return <SubPage 
          todaysImageResponse={todaysImageResponse}
          todaysMetadataResponse={todaysMetadataResponse} />
}

const SubPage = ({ todaysImageResponse, todaysMetadataResponse }) => {
  const [currReaction, setCurrReaction] = useState('NoReaction');
  const [currUuid, setCurrUuid] = useState(null);
  const [currReactionCounts, setCurrReactionCounts] = useState(null);

  // Set state and localStorage based on todays metadata
  useEffect(() => {
    if (todaysMetadataResponse.isSuccess) {
      setCurrReaction(todaysMetadataResponse.data.reaction);
    
      const currUuid = localStorage.getItem('uuid')

      if (currUuid === null) {
        localStorage.setItem('uuid', todaysMetadataResponse.data.uuid);
        setCurrUuid(todaysMetadataResponse.data.uuid);
      } else {
        setCurrUuid(currUuid);
      }
    }
  }, [todaysMetadataResponse])


  useEffect(() => {
    if (todaysMetadataResponse.isSuccess) {
      setCurrReactionCounts(todaysMetadataResponse.data.counts);
    }
  }, [todaysMetadataResponse]);

  // On emoji press, update the reaction
  const onEmojiClick = (uuid) => (reaction) => {
    axios.put(TODAYS_METADATA_ENDPOINT, {'reaction': reaction, 'uuid': uuid})
    .then(res => {
      // Means the put was successful
      setCurrReaction(reaction)
      setCurrReactionCounts(res.data.counts)
    })
  }

  return (
    <div className='flex flex-col justify-start pl-2 pr-2 pb-5 items-center min-w-screen min-h-screen text-white bg-black'>
      <div className='flex justify-between items-center w-screen font-serif p-1 text-4xl'> 
        <p>
          ForMaeov
        </p>
        <img src={heart} className='text-left bg-black h-20 w-20' alt="Human heart" />
      </div>
      <AppBody 
            todaysImageLoading={todaysImageResponse.isLoading}
            todaysMetadataLoading={todaysMetadataResponse.isLoading}
            imageUrl={todaysImageResponse.data} 
            currReaction={currReaction}
            currReactionCounts={currReactionCounts}
            currUuid={currUuid}
            onEmojiClick={onEmojiClick} />
    </div>
  );
}

const AppBody = ({todaysImageLoading, todaysMetadataLoading, imageUrl, currReaction, currReactionCounts, currUuid, onEmojiClick}) => (
  <div className='flex flex-col align-center justify-center'>
      {
        todaysImageLoading || todaysMetadataLoading
          ? <Loading /> 
          : <Successful 
              imageUrl={imageUrl}
              currUuid={currUuid}
              currReaction={currReaction}
              currReactionCounts={currReactionCounts}
              onEmojiClick={onEmojiClick(currUuid)} />
      }
  </div>
);

const Successful = ({imageUrl, currReaction, currReactionCounts, onEmojiClick}) => {
  return <div>
    <img src={`${imageUrl}`} className='object-scale-down max-w-50 max-h-50' alt="todays pic" />
    <ReactionCounts currReactionCounts={currReactionCounts} />
    <Selector currReaction={currReaction} onSelect={onEmojiClick} />
  </div>
}

const Loading = ({props}) => {
  return <div class="lds-roller"><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div></div>
}