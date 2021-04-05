const fs = require('fs/promises');
const path = require('path');
const _ = require('lodash');

const config = require('./config.json');

module.exports = async (episodeFile) => {
  try {
    if (episodeFile) {
      let exists = true;
      if (!episodeFile.match(config.animeRegex)) {
        return;
      }
      try {
        await fs.stat(path.join(config.downloadsDirectory, episodeFile));
      } catch (err) {
        exists = false;
      }
      if (!exists) {
        return;
      }
      console.log(`episodeFile: ${episodeFile}`);
    }

    const filesDownloaded = episodeFile ? [episodeFile] : await fs.readdir(config.downloadsDirectory);
    const animeFoldersObj = {};
    const episodes = _.filter(filesDownloaded, ep => {
      const match = ep.match(new RegExp(config.animeRegex));
      if (!_.isNull(match)) {
        let animeFolderName = match[2];
        if (animeFolderName.split("").reverse()[0] === ".") {
          animeFolderName = animeFolderName.slice(0, -1);
        }
        animeFoldersObj[animeFolderName] = true;
      }
      return match;
    });
    const animeFolders = _.keys(animeFoldersObj);

    const currentAnimeFolders = await fs.readdir(config.plexAnimeDirectory);

    const foldersToCreate = _.without(animeFolders, ...currentAnimeFolders);
    console.log(`foldersToCreate: ${JSON.stringify(foldersToCreate, null, 2)}`);
    for (const folderToCreate of foldersToCreate) {
      const fullFolderPath = path.join(config.plexAnimeDirectory, folderToCreate);
      await fs.mkdir(fullFolderPath);
    }

    // move the files
    for (const animeName of animeFolders) {
      const animeEpisodes = _.filter(episodes, ep => _.includes(ep, animeName));
      console.log(`animeEpisodes: ${JSON.stringify(animeEpisodes, null, 2)}`);
      for (const animeEpisode of animeEpisodes) {
        const oldAnimePath = path.join(config.downloadsDirectory, animeEpisode);;
        const newAnimePath = path.join(config.plexAnimeDirectory, animeName, animeEpisode);

        // add retry logic to handle when utorrent locks file
        let continueTrying = true;
        let count = 0;
        await new Promise(res => setTimeout(res, 1 * 1000));
        do {
          count += 1;
          try {
            await fs.rename(oldAnimePath, newAnimePath);
            continueTrying = false;
          } catch (error) {
            await new Promise(res => setTimeout(res, config.moveRetryIntervalMs));
            if (count === 1) {
              console.error(error);
            }
            if (count === config.moveRetryCount) {
              continueTrying = false;
              console.error(`Tried ${config.moveRetryCount} times. Bailing out now.`);
            }
          }
        } while (continueTrying)
      }
    }

    // delete all older files
    for (const animeName of animeFolders) {
      const animePath = path.join(config.plexAnimeDirectory, animeName);
      const episodes = await fs.readdir(animePath);
      const possibleDuplicates = {};
      _.forEach(episodes, ep => {
        const episodeNumber = ep.match(new RegExp(config.episodeNumberRegex))[1];
        possibleDuplicates[episodeNumber] = possibleDuplicates[episodeNumber] || [];
        possibleDuplicates[episodeNumber].push(ep);
      });
      const duplicates = _.pickBy(possibleDuplicates, dup => dup.length > 1);
      _.forEach(
        duplicates,
        async episodeNames => {
          const filesWithCtime = _.reverse(_.sortBy(
            await Promise.all(
              _.map(episodeNames, async episodeName => {
                const animeFile = path.join(animePath, episodeName);
                const stats = await fs.stat(animeFile);
                return {
                  episodeName,
                  ctime: stats.ctime
                };
              })
            ),
            episode => episode.ctime
          ));
          await _.forEach(filesWithCtime, async (episode, i) => {
            if (i === 0) {
              return;
            }
            const animeFileToDelete = path.join(animePath, episode.episodeName);
            await fs.unlink(animeFileToDelete);
          })
        }
      );
    }
  } catch (error) {
    console.error(error);
    await new Promise(res => setTimeout(res, 10 * 1000));
  }
};
