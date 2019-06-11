var post = (module.exports = {});
const config = require("../config.json");

const { tall } = require("tall");
let users = require("./users");
const gets = require("./gets");
const log = require("./log");
const discord = require("./discord");

post.colors = {
  text: 0x69b2d6,
  video: 0x67d67d,
  image: 0xd667cf,
  images: 0x53a38d
};

function unshortenUrls(text, callback) {
  let urls = [];
  let re = /https:\/\/t\.co\/[\w]+/g;
  let match = {};
  while ((match = re.exec(text))) {
    const url = text.substring(match.index, re.lastIndex);
    urls.push(url);
  }
  if (urls.length < 1) {
    callback(text);
    return;
  }

  const promises = urls.map((shortUrl, idx) =>
    tall(shortUrl).then(longUrl => ({
      shortUrl,
      longUrl,
      idx
    }))
  );
  Promise.all(promises)
    .then(results => {
      results.forEach(({ shortUrl, longUrl, idx }) => {
        text = text.replace(
          shortUrl,
          urls.length > 1 && idx === urls.length - 1
            ? `\n[Tweet](${longUrl})`
            : longUrl
        );
      });
      callback(text);
    })
    .catch(e => {
      log("The elusive buggerino!");
      log(`Total message: ${text}`);
      log(`URL we tried shortening: ${shortUrl}`);
      log(e);
    });
}

const getChannelOwner = channel =>
  channel.type === "dm" ? channel.recipient : channel.guild.owner;

const handleDiscordPostError = (error, channel, type, msg, errorCount = 0) => {
  const errCode = error.statusCode || error.code || error.status;
  if (errCode === 404 || errCode === 10003) {
    // The channel was deleted or we don't have access to it, auto-delete it
    log(`${errCode}: Auto-deleting ${count} gets, channel removed`, channel);
    const count = gets.rmChannel(channel.id);
    post.dm(
      getChannelOwner(channel),
      `Hi! I tried to #${
        channel.name
      } but Discord tells me I can't access it anymore.\n\nI took the liberty of stopping all ${count} twitter fetches in that channel.\n\nIf this isn't what you wanted, please contact my owner \`Tom'#4242\` about this immediately!`
    );
    return;
  } else if (
    errCode === 403 ||
    errCode === 50013 ||
    errCode === 50001 ||
    errCode === 50004 ||
    errCode === 40001
  ) {
    // Discord MissingPermissions error
    // Try to find the 1st channel we can post in
    log(
      `Tried to post ${type} but lacked permissions: ${errCode} ${error.name}`,
      channel
    );
    const permissionsMsg = `Hello!\nI just tried to post a message in #${
      channel.name
    }, but Discord says I don't have any rights to it.\n\nIf a mod could give me the right to **Send Messages** and **Send Embeds** permissions there that would be nice.\nIf you'd like me to stop trying to send messages there, moderators can use \`${
      config.prefix
    }stopchannel ${
      channel.id
    }\`.\nIf you think you've done everything right but keep getting this message, please contact my creator (\`Tom'#4242\`) about this so he can look into it with you. Thanks!`;
    if (channel.type === "text" && errorCount === 0) {
      const postableChannel = discord.canPostIn(channel)
        ? channel
        : channel.guild.channels
            .filter(c => c.type === "text")
            .find(c => discord.canPostIn(c));
      if (postableChannel) {
        postableChannel
          .send(permissionsMsg)
          .then(
            log("Sent a message asking to get permissions", postableChannel)
          )
          .catch(err => {
            handleDiscordPostError(
              err,
              postableChannel,
              "message",
              permissionsMsg,
              1
            );
          });
        return;
      }
    }
    // If it was a message, just try and msg the owner
    post.dm(getChannelOwner(channel), permissionsMsg);
    log(`${errCode}: Owner has been notified`, channel);
    return;
  } else if (
    errCode === "ECONNRESET" ||
    errCode === "read ECONNRESET" ||
    errCode === 504
  ) {
    // Discord servers fucked up, gatweay timeout
    if (errorCount >= 2) {
      log(
        `${errCode}: Discord servers failed receiving ${type} ${errorCount} times, giving up`,
        channel
      );
      return;
    }
    log(
      `${errCode}: Discord servers failed when I tried to send ${type} (attempt #${errorCount +
        1})`,
      channel
    );
    setTimeout(() => {
      channel.send(msg).catch(err => {
        handleDiscordPostError(err, channel, type, msg, errorCount + 1);
      });
    }, 5000);
    return;
  }
  log(
    `Posting ${type} failed (${errCode} ${error.name}): ${error.message}`,
    channel
  );
  log(error, channel);
  if (channel.type !== "dm")
    post.dm(
      channel.guild.owner,
      `I'm trying to send a message in #${
        channel.name
      } but Discord won't let me! My creator has been warned, but you can contact him if this persists.\n\nThis is the reason Discord gave: ${
        error.message
      }`
    );
};

// React is a boolean, if true, add a reaction to the message after posting
post.embed = (channel, embed, react) => {
  channel
    .send(embed)
    .then(function(message) {
      if (react)
        message.react("❤").catch(err => {
          // Don't log this as it's not critical
        });
    })
    .catch(err => {
      handleDiscordPostError(err, channel, "embed", embed);
    });
};

post.message = (channel, message) => {
  channel.send(message).catch(err => {
    handleDiscordPostError(err, channel, "message", message);
  });
};

post.announcement = (message, channels) => {
  if (channels.length <= 0) return;
  const nextChannel = channels.shift();
  post.message(nextChannel, message);
  setTimeout(() => {
    post.announcement(message, channels);
  }, 1000);
};

post.dm = (author, message) => {
  author.send(message).catch(err => {
    log(`Couldn't sent a message to ${author.username}`);
    log(err);
  });
};