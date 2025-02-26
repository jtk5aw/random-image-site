import heart from './HUMAN_HEART-cropped.svg';
import { SET_FAVORITE_ENDPOINT, TODAYS_IMAGE_ENDPOINT, TODAYS_METADATA_ENDPOINT } from './config/api';
import './App.css';

import axios from 'axios';
import React, { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from 'react-query';
import ErrorBanner from './components/ErrorBanner/ErrorBanner';
import Selector from './components/Reactions/Selector';
import ReactionCounts from './components/Reactions/ReactionCounts';
import DailyImage from './components/DailyImage/Image';
import Swiper from './components/Swiper/Swiper';

import { register } from 'swiper/element/bundle';
import { hasReacted } from './components/Reactions/utils';
import { NO_REACTION } from './config/constants';

register();
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
        .then((res) => res.data)
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
  const [error, setError] = useState(null);

  const [todaysImage, setTodaysImage] = useState(null);

  const [currUuid, setCurrUuid] = useState(null);
  const [currReaction, setCurrReaction] = useState(NO_REACTION);
  const [currReactionCounts, setCurrReactionCounts] = useState(null);

  const [weeklyRecap, setWeeklyRecap] = useState(null);
  const [currFavoriteUrl, setCurrFavoriteUrl] = useState('');
  const [showSlider, setShowSlider] = useState(false);

  // Set the current image and potential set of weekly recap images
  useEffect(() => {
    if (todaysImageResponse.isSuccess) {
      setTodaysImage(todaysImageResponse.data.url);
    }
  }, [todaysImageResponse]);

  useEffect(() => {
    if (todaysImageResponse.isSuccess && todaysImageResponse.data.weekly_recap != null) {
      setWeeklyRecap(todaysImageResponse.data.weekly_recap);
    }
  }, [todaysImageResponse]);

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
  }, [todaysMetadataResponse]);

  useEffect(() => {
    if (todaysMetadataResponse.isSuccess) {
      setCurrFavoriteUrl(todaysMetadataResponse.data.favorite_image);
    }
  }, [todaysMetadataResponse]);

  useEffect(() => {
    if (todaysMetadataResponse.isSuccess) {
      setCurrReactionCounts(todaysMetadataResponse.data.counts);
    }
  }, [todaysMetadataResponse]);

  // On emoji press, update the reaction
  const onEmojiClick = (uuid) => (reaction) => {
    const reactionToSend = reaction === currReaction ? NO_REACTION : reaction; 
    setCurrReaction(reactionToSend)

    // TODO TODO TODO: Add a failure banner when the call fails
    axios.put(TODAYS_METADATA_ENDPOINT, {'reaction': reactionToSend, 'uuid': uuid})
    .then(res => {
      // Means the put was successful
      setCurrReactionCounts(res.data.counts)
    })
    .catch(err => {
      // Set error message
      setError('Failed to update reaction.');
      console.error('Error updating reaction:', err);
    });
  }

  // On recap image press, update the favorite URL 
  const onRecapClick = (uuid) => (url) => {
    const urlToSend = url === currFavoriteUrl ? '' : url;
    // Assume the call will succeed 
    setCurrFavoriteUrl(urlToSend);
    axios.put(SET_FAVORITE_ENDPOINT, {'favorite_image': urlToSend, 'uuid': uuid })
    .catch(err => {
      // Set error message
      setError('Failed to update favorite.');
      console.error('Error updating favorite:', err);
    });
  }

  // On Recent Image button click, toggle screen viewed
  const onToggleRecentImagesClick = () => {
    if (weeklyRecap !== null && hasReacted(currReaction)) {
      setShowSlider(!showSlider);
    }
  }
  const showRecentFavorites = (currReaction, showSlider) => weeklyRecap !== null && hasReacted(currReaction) && !showSlider;

  return (
    <div className='min-w-screen min-h-screen text-white bg-black'>
      <div className='flex justify-between items-center w-screen max-w-screen-md font-serif p-1 text-4xl'> 
        <p>
          ForMaeov
        </p>
        <img 
          src={heart} 
          className='text-left bg-black h-20 w-20'
          alt="Human heart" />
      </div>
      {error && <ErrorBanner errorMessage={error} onClose={() => setError(null)} />}
      <AppBody 
            todaysImageLoading={todaysImageResponse.isLoading}
            todaysMetadataLoading={todaysMetadataResponse.isLoading}
            imageUrl={todaysImage} 
            weeklyRecap={weeklyRecap}
            currReaction={currReaction}
            currReactionCounts={currReactionCounts}
            currUuid={currUuid}
            currFavoriteUrl={currFavoriteUrl}
            onEmojiClick={onEmojiClick(currUuid)}
            onRecapClick={onRecapClick(currUuid)}
            onToggleRecentImagesClick={onToggleRecentImagesClick}
            showSlider={showSlider}
            showRecentFavorites={showRecentFavorites(currReaction, showSlider)}/>
    </div>
  );
}

const AppBody = ({
  todaysImageLoading, 
  todaysMetadataLoading, 
  imageUrl, 
  weeklyRecap, 
  currReaction, 
  currReactionCounts, 
  currUuid, 
  currFavoriteUrl, 
  onEmojiClick, 
  onRecapClick, 
  onToggleRecentImagesClick,
  showSlider,
  showRecentFavorites
}) => (
  <div>
      {
        todaysImageLoading || todaysMetadataLoading
          ? <Loading /> 
          : <Content
              showSlider={showSlider}
              weeklyRecap={weeklyRecap}
              currFavoriteUrl={currFavoriteUrl}
              onRecapClick={onRecapClick}
              imageUrl={imageUrl}
              currReaction={currReaction}
              currReactionCounts={currReactionCounts}
              showRecentFavorites={showRecentFavorites}
              onEmojiClick={onEmojiClick}
              onToggleRecentImagesClick={onToggleRecentImagesClick} />
      }
  </div>
);

const Content = ({showSlider, weeklyRecap, currFavoriteUrl, onRecapClick, imageUrl, currReaction, currReactionCounts, showRecentFavorites, onEmojiClick, onToggleRecentImagesClick}) => {
  return showSlider
    ? <Swiper 
        weeklyRecap={weeklyRecap}
        currFavoriteUrl={currFavoriteUrl}
        onRecapClick={onRecapClick}
        onToggleRecentImagesClick={onToggleRecentImagesClick}
        />
    : <Image 
        imageUrl={imageUrl}
        weeklyRecap={weeklyRecap}
        currReaction={currReaction}
        currReactionCounts={currReactionCounts}
        currFavoriteUrl={currFavoriteUrl}
        showRecentFavorites={showRecentFavorites}
        onEmojiClick={onEmojiClick}
        onToggleRecentImagesClick={onToggleRecentImagesClick} />
}

const Image = ({imageUrl, currReaction, currReactionCounts, currFavoriteUrl, showRecentFavorites, onEmojiClick, onToggleRecentImagesClick}) => {
  return <div className='max-w-screen-md'>
    <DailyImage url={imageUrl} alt={"todays pic"} />
    <ReactionCounts 
      currReactionCounts={currReactionCounts} 
      onToggleRecentImagesClick={ showRecentFavorites ? onToggleRecentImagesClick : null }
      hasFavorite={currFavoriteUrl !== ''}/>
    <Selector currReaction={currReaction} onSelect={onEmojiClick} />
  </div>
}

const Loading = ({props}) => {
  return <div className='text-center'>
      <div className="lds-roller"><div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div></div>
    </div>
}
