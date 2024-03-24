import { useEffect, useState } from 'react';
import List from '@mui/joy/List';
import ListItem from '@mui/joy/ListItem';
import ListItemButton from '@mui/joy/ListItemButton';
import ListItemContent from '@mui/joy/ListItemContent';
import Sheet from '@mui/joy/Sheet';
import Stack from '@mui/joy/Stack';
import Typography from '@mui/joy/Typography';

import { BrowserOpenURL } from '@runtime/runtime';
import {
  Avatar, Chip, Divider, ListItemDecorator,
} from '@mui/joy';

type RssArticle = {
  title: string;
  image: string;
  link: string;
  description: string;
  pubDate: string;
};

const knownSpamPhrases = [
  'Money Plus Loan',
];

const parsers = {
  'medium.com'(item: Element) {
    const content = item.getElementsByTagName('description')[0].textContent;
    const parsed = MediumContentToHTML(content || '');
    let title = item.getElementsByTagName('title')[0].textContent || '';

    // ignore spammed articles if the title contains any of the known spam phrases
    if (knownSpamPhrases.some(phrase => title.includes(phrase))) {
      title = 'SPAM';
    }

    return {
      title,
      image: parsed.image,
      description: parsed.text,
      link: item.getElementsByTagName('link')[0].textContent || '',
      pubDate: item.getElementsByTagName('pubDate')[0].textContent || '',
    };
  },
};

const MediumContentToHTML = (content: string) => {
  if (!content) {
    return {
      image: '',
      text: '',
      link: '',
    };
  }

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(content, 'text/html');

  const imageEl = xmlDoc.getElementsByClassName('medium-feed-image');
  // Get the img element within the above
  const imgTag = imageEl[0].getElementsByTagName('img')[0];
  // Get the src attribute of the img element
  const image = imgTag.getAttribute('src');

  const textTag = xmlDoc.getElementsByClassName('medium-feed-snippet');
  const text = textTag[0].textContent;

  const linkEl = xmlDoc.getElementsByClassName('medium-feed-link');
  // Get a tag within the above
  const a = linkEl[0].getElementsByTagName('a')[0];
  // Get the href attribute of the a tag
  const link = a.getAttribute('href');

  return {
    image,
    text,
    link,
  };
};

function RssFeedList() {
  const [articles, setArticles] = useState<RssArticle[]>([]);

  useEffect(() => {
    const fetchRssFeed = async () => {
      try {
        const proxyUrl = 'https://api.allorigins.win/get?url=';
        const feedUrl = 'https://medium.com/feed/tag/kubernetes';
        const response = await fetch(proxyUrl + encodeURIComponent(feedUrl));
        const resp = await response.json();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(resp.contents, 'text/xml');
        console.log('xmlDoc', xmlDoc);
        const items = xmlDoc.getElementsByTagName('item');
        console.log('items', items);
        const feedItems = Array.from(items).map(item => parsers['medium.com'](item)).filter(item => item.title !== 'SPAM') as RssArticle[];
        console.log('feedItems', feedItems);
        setArticles(feedItems);
      } catch (error) {
        console.error('Error fetching or parsing RSS feed:', error);
      }
    };

    fetchRssFeed();
  }, []);

  return (
    <Sheet variant='outlined' sx={{ width: '100%', mx: 'auto', borderRadius: 6 }}>
      <Typography level='h1' fontSize='lg' component='div' sx={{ p: 2 }}>
        Articles
      </Typography>
      <Divider />
      <List
        size='lg'
        sx={{
          width: '100%',
          borderRadius: 1,
          overflow: 'auto',
        }}
      >
        {articles.map((article, index) => (
          <ListItem key={index}>
            <ListItemButton onClick={() => {
              article.link && BrowserOpenURL(article.link);
            }}>
              <ListItemDecorator>
                <Avatar size='lg' src={article.image} sx={{
                  borderRadius: 6, backgroundColor: 'transparent', objectFit: 'contain', border: 0,
                }} />
              </ListItemDecorator>
              <ListItemContent>
                <Stack direction='column' width={'100%'} px={2}>
                  <Typography display={'flex'} justifyContent={'space-between'} level='h2' fontSize='md' component='h3' sx={{ fontWeight: 'bold' }}>
                    {article.title}
                    <Chip variant='outlined' color='neutral' size='sm' sx={{ ml: 1, pointerEvents: 'none' }}>{new Date(article.pubDate).toLocaleDateString()}</Chip>
                  </Typography>
                  <Typography level='body-sm' fontSize='sm' sx={{ mt: 0.5 }}>
                    {article.description}
                  </Typography>
                </Stack>
              </ListItemContent>
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Sheet>
  );
}

export default RssFeedList;

