import { ChannelType, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const JsonBinUrl = `https://api.jsonbin.io/v3/b/${process.env.JSONBIN_ID}`;

const R2 = new S3Client({
  endpoint: `https://${process.env.R2AccountId}.r2.cloudflarestorage.com`,
  region: "auto",
  credentials: {
    accessKeyId: process.env.R2AccessKey,
    secretAccessKey: process.env.R2SecretKey
  },
});

const ModerationRoles = [
  "1403777886661644398",
  "1403777609522745485",
  "1403777335416848537",
  "1403777452517494784",
  "1403777162460397649",
  "1423280211239243826"
];

async function GetTickets() {
  const res = await fetch(JsonBinUrl, { headers: { "X-Master-Key": process.env.JSONBIN_KEY } });
  const data = await res.json();
  return data.record || {};
}

async function SaveTickets(tickets) {
  await fetch(JsonBinUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Master-Key": process.env.JSONBIN_KEY },
    body: JSON.stringify(tickets)
  });
}

async function UploadToR2(buffer, key, contentType) {
  const cmd = new PutObjectCommand({
    Bucket: process.env.R2Bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    ACL: "public-read"
  });
  try {
    await R2.send(cmd);
    return `${process.env.R2PublicBase}/${key}`;
  } catch (err) {
    console.error("R2 upload failed:", err);
    return null;
  }
}

async function ProcessAttachments(message) {
  const attachments = [];
  for (const att of message.attachments.values()) {
    const res = await fetch(att.url);
    const buffer = await res.arrayBuffer();
    const ext = att.name.split(".").pop().toLowerCase();
    const key = `attachments/${message.id}-${att.name}`;
    const url = await UploadToR2(Buffer.from(buffer), key, att.contentType || "application/octet-stream");
    if (url) attachments.push({ url, type: ext, name: att.name });
  }
  return attachments;
}

function EscapeHtml(text) {
  return text;
}

function GetCategoryType(CategoryId) {
  if (CategoryId === process.env.REPORT_CATEGORY) return "Report";
  if (CategoryId === process.env.APPEAL_CATEGORY) return "Appeal";
  if (CategoryId === process.env.INQUIRY_CATEGORY) return "Inquiry";
  return "Unknown";
}

async function SyncPermissions(Channel, Category, OwnerId) {
  if (!Category) return;
  const Overwrites = Category.permissionOverwrites.cache.map(Po => ({
    id: Po.id,
    allow: new PermissionsBitField(Po.allow).bitfield,
    deny: new PermissionsBitField(Po.deny).bitfield
  }));

  for (const RoleId of ModerationRoles) {
    Overwrites.push({
      id: RoleId,
      allow: new PermissionsBitField([
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.SendMessages
      ]).bitfield,
      deny: 0n
    });
  }

  await Channel.permissionOverwrites.set(Overwrites);
  await Channel.permissionOverwrites.edit(OwnerId, {
    ViewChannel: true,
    SendMessages: true,
    AttachFiles: true
  });
}

async function GenerateTranscriptHtml(ChannelName, Messages, Guild) {
  const Css = `
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #36393f; color: #dcddde; padding: 20px; }
    h1 { color: #fff; }
    .message { display: flex; margin-bottom: 12px; }
    .avatar { width: 40px; height: 40px; border-radius: 50%; margin-right: 10px; flex-shrink: 0; }
    .content { background: #2f3136; border-radius: 8px; padding: 8px 12px; flex: 1; }
    .header { font-weight: 600; color: #fff; }
    .timestamp { font-weight: 400; font-size: 0.75em; color: #72767d; margin-left: 6px; }
    .text { margin-top: 2px; white-space: pre-wrap; word-wrap: break-word; }
    img.attachment, video.attachment { max-width: 100%; border-radius: 5px; margin-top: 5px; }
    .sticker { width: 120px; height: auto; margin-top: 5px; }
    .embed { border-left: 4px solid; padding: 8px; margin-top: 6px; border-radius: 5px; background: #2f3136; }
    .embed-title { font-weight: 700; font-size: 0.95em; margin-bottom: 2px; }
    .embed-description { margin-top: 2px; font-size: 0.9em; }
    .embed-field { margin-top: 4px; }
    .embed-field-name { font-weight: 600; font-size: 0.85em; }
    .embed-field-value { font-size: 0.85em; margin-left: 4px; }
    .embed-image, .embed-thumbnail { max-width: 300px; margin-top: 4px; border-radius: 4px; }
  `;
  let Html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>Transcript - ${ChannelName}</title>
    <style>${Css}</style>
  </head>
  <body>
    <h1>Transcript for #${ChannelName}</h1>
  `;

  Messages.reverse().forEach(Msg => {
    const Timestamp = new Date(Msg.createdTimestamp).toLocaleString();
    let content = Msg.content || "";
    content = content.replace(/<@!?(\d+)>/g, (_, id) => {
      const m = Guild.members.cache.get(id);
      return m ? `@${m.displayName}` : "@Unknown";
    });

    Html += `
      <div class="message">
        <img class="avatar" src="${Msg.author.displayAvatarURL({ format: 'png', size: 128 })}" alt="${Msg.author.tag}">
        <div class="content">
          <div class="header">${EscapeHtml(Msg.author.tag)} <span class="timestamp">${Timestamp}</span></div>
          <div class="text">${EscapeHtml(content)}</div>
    `;

    (Msg.processedAttachments || []).forEach(Att => {
      if (['png','jpg','jpeg','webp','gif'].includes(Att.type)) {
        Html += `<a href="${Att.url}" target="_blank"><img class="attachment" src="${Att.url}" alt="Attachment"></a>`;
      } else if (['mp4','mov','webm'].includes(Att.type)) {
        Html += `<video class="attachment" controls src="${Att.url}"></video>`;
      } else {
        Html += `<a href="${Att.url}" target="_blank">Attachment: ${EscapeHtml(Att.name)}</a>`;
      }
    });

    if (Msg.stickers?.length) {
      Msg.stickers.forEach(sticker => {
        Html += `<img class="sticker" src="https://cdn.discordapp.com/stickers/${sticker.id}.png" alt="${EscapeHtml(sticker.name)}">`;
      });
    }

    if (Msg.embeds?.length) {
      Msg.embeds.forEach(embed => {
        const Color = embed.hexColor || '#7289da';
        Html += `<div class="embed" style="border-color:${Color}">`;
        if (embed.title) Html += `<div class="embed-title">${EscapeHtml(embed.title)}</div>`;
        if (embed.description) Html += `<div class="embed-description">${EscapeHtml(embed.description || '')}</div>`;
        if (embed.fields?.length) {
          embed.fields.forEach(f => {
            Html += `<div class="embed-field"><span class="embed-field-name">${EscapeHtml(f.name)}:</span><span class="embed-field-value">${EscapeHtml(f.value)}</span></div>`;
          });
        }
        if (embed.image?.url) Html += `<a href="${embed.image.url}" target="_blank"><img class="embed-image" src="${embed.image.url}" alt="Embed Image"></a>`;
        if (embed.thumbnail?.url) Html += `<a href="${embed.thumbnail.url}" target="_blank"><img class="embed-thumbnail" src="${embed.thumbnail.url}" alt="Embed Thumbnail"></a>`;
        if (embed.video?.url) Html += `<video class="embed-image" controls src="${embed.video.url}"></video>`;
        Html += `</div>`;
      });
    }

    Html += `</div></div>`;
  });

  Html += `</body></html>`;
  return Html;
}

async function UploadTranscript(ChannelId, Html) {
  const Key = `${ChannelId}.html`;
  const Command = new PutObjectCommand({
    Bucket: process.env.R2Bucket,
    Key,
    Body: Html,
    ContentType: "text/html",
    ACL: "public-read"
  });
  try {
    await R2.send(Command);
    return `${process.env.R2PublicBase}/${Key}`;
  } catch (Err) {
    console.error("R2 upload failed:", Err);
    return "https://example.com";
  }
}

export default {
  name: "interactionCreate",
  async execute(Interaction, Client) {
    const Guild = Interaction.guild;
    const User = Interaction.user;
    let ActiveTickets = await GetTickets();

    if (!Client.TicketCounts) Client.TicketCounts = { Report: 0, Appeal: 0, Inquiry: 0 };
    for (const T of Object.values(ActiveTickets)) {
      if (T.categoryType && typeof T.ticketNumber === "number") {
        if (!Client.TicketCounts[T.categoryType] || Client.TicketCounts[T.categoryType] < T.ticketNumber) {
          Client.TicketCounts[T.categoryType] = T.ticketNumber;
        }
      }
    }

    if (Interaction.isChatInputCommand()) {
      const Command = Client.commands.get(Interaction.commandName);
      if (!Command) return;
      try { await Command.execute(Interaction, Client); } catch (err) { console.error(err); Interaction.reply({ content: "Error executing command.", ephemeral: true }); }
      return;
    }

    if (Interaction.isStringSelectMenu() && Interaction.customId === "move_ticket") {
      const SelectedCategoryId = Interaction.values[0];
      if (!SelectedCategoryId) return Interaction.reply({ content: "Invalid category selected.", ephemeral: true });
      const OldCategory = Guild.channels.cache.get(Interaction.channel.parentId);
      await Interaction.channel.setParent(SelectedCategoryId).catch(() => {});
      const NewCategory = Guild.channels.cache.get(SelectedCategoryId);
      const TicketData = ActiveTickets[Interaction.channel.id];
      if (TicketData) await SyncPermissions(Interaction.channel, NewCategory, TicketData.ownerId);
      try {
        const Owner = await Client.users.fetch(TicketData.ownerId);
        const MoveEmbed = new EmbedBuilder()
          .setTitle("Ticket Moved")
          .setColor("Yellow")
          .setDescription(`Your ticket has been moved from **${OldCategory ? OldCategory.name : "Unknown"}** to **${NewCategory ? NewCategory.name : "Unknown"}**.`);
        await Owner.send({ embeds: [MoveEmbed] });
      } catch (Err) { console.error("Failed to DM ticket owner:", Err); }
      return Interaction.reply({ content: `Ticket moved to <#${SelectedCategoryId}> and synced permissions successfully.`, ephemeral: true });
    }

    if (!Interaction.isButton()) return;
    const TicketData = ActiveTickets[Interaction.channel.id];

    if (Interaction.customId.startsWith("confirm_close_")) {
      await Interaction.deferReply({ ephemeral: false });
      const Confirmed = Interaction.customId.endsWith("yes");
      const LogChannel = await Guild.channels.fetch("1417526499761979412").catch(() => null);
      if (!LogChannel?.isTextBased()) return Interaction.editReply({ content: "Log channel not found." });
      if (!TicketData) return Interaction.editReply({ content: "Ticket data not found." });
      if (!Confirmed) { await Interaction.message.edit({ content: "Ticket close cancelled.", components: [] }); await Interaction.editReply({ content: "Cancelled ticket closure." }); return; }

      const Messages = await Interaction.channel.messages.fetch({ limit: 100 });
      const Html = await GenerateTranscriptHtml(Interaction.channel.name, Messages, Guild);
      let TranscriptUrl = "";
      try { TranscriptUrl = await UploadTranscript(Interaction.channel.id, Html); } 
      catch (Err) { console.error("R2 upload failed:", Err); TranscriptUrl = "https://example.com"; }

      const CloseEmbed = new EmbedBuilder()
        .setTitle("Ticket Closed")
        .addFields(
          { name: "Ticket", value: Interaction.channel.name, inline: true },
          { name: "Closed by", value: User.tag, inline: true },
          { name: "Channel ID", value: Interaction.channel.id, inline: true }
        )
        .setColor("Red")
        .setTimestamp();

      const TranscriptButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel("Transcript").setStyle(ButtonStyle.Link).setURL(TranscriptUrl)
      );

      await LogChannel.send({ embeds: [CloseEmbed], components: [TranscriptButton] });

      const CreatedAt = TicketData.createdAt ? new Date(TicketData.createdAt) : new Date();
      const ClosedAt = new Date();
      const DiffDays = Math.round((ClosedAt - CreatedAt) / (1000 * 60 * 60 * 24));
      const CategoryType = GetCategoryType(Interaction.channel.parentId);
      const TicketNumber = TicketData.ticketNumber;

      const DmEmbed = new EmbedBuilder()
        .setTitle("Ticket Closed")
        .setColor("Red")
        .addFields(
          { name: "Ticket", value: `${CategoryType} #${TicketNumber}`, inline: false },
          { name: "Created At", value: CreatedAt.toLocaleString(), inline: true },
          { name: "Closed At", value: `${ClosedAt.toLocaleString()} (${DiffDays} day${DiffDays !== 1 ? "s" : ""})`, inline: true },
          { name: "Closed By", value: User.tag, inline: false }
        );

      const DmButton = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel("Transcript").setStyle(ButtonStyle.Link).setURL(TranscriptUrl)
      );

      try { const Owner = await Client.users.fetch(TicketData.ownerId); await Owner.send({ embeds: [DmEmbed], components: [DmButton] }); } 
      catch (Err) { console.error("Failed to DM user:", Err); }

      delete ActiveTickets[Interaction.channel.id];
      await SaveTickets(ActiveTickets);
      await Interaction.editReply({ content: "Ticket closed, transcript saved to log channel." });
      await Interaction.message.edit({ components: [] });
      setTimeout(() => Interaction.channel.delete().catch(() => {}), 2000);
      return;
    }

    if (Interaction.customId === "close_ticket") {
      const ConfirmEmbed = new EmbedBuilder()
        .setTitle("Confirm Ticket Closure")
        .setDescription("Are you sure you want to close this ticket?")
        .setColor("Red");
      const ConfirmButtons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("confirm_close_yes").setLabel("Yes, close it").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("confirm_close_no").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
      );
      await Interaction.reply({ embeds: [ConfirmEmbed], components: [ConfirmButtons], ephemeral: false });
      return;
    }

    if (Interaction.customId === "claim_ticket") {
      await Interaction.deferReply({ ephemeral: false });

      if (!TicketData) return Interaction.editReply({ content: "Ticket data not found." });
      if (TicketData.claimerId) return Interaction.editReply({ content: "This ticket is already claimed." });

      const Member = await Guild.members.fetch(User.id);
      const HasRole = Member.roles.cache.some(R => ModerationRoles.includes(R.id));

      if (!Member.permissions.has(PermissionsBitField.Flags.Administrator) && !HasRole)
        return Interaction.editReply({ content: "You do not have permission to claim tickets." });

      TicketData.claimerId = User.id;
      ActiveTickets[Interaction.channel.id] = TicketData;
      await SaveTickets(ActiveTickets);

      const FetchedMessages = await Interaction.channel.messages.fetch({ limit: 10 });
      const TicketMessage = FetchedMessages.find(M => M.components.length > 0);

      if (TicketMessage) {
        const UpdatedRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("close_ticket").setLabel("Close Ticket").setStyle(ButtonStyle.Danger)
        );
        await TicketMessage.edit({ components: [UpdatedRow] });
      }

      const Category = Interaction.channel.parent
        ? Guild.channels.cache.get(Interaction.channel.parentId)
        : null;

      if (Category) await SyncPermissions(Interaction.channel, Category, TicketData.ownerId);

      await Interaction.channel.permissionOverwrites.edit(TicketData.ownerId, {
        ViewChannel: true,
        SendMessages: true,
        AttachFiles: true
      });

      await Interaction.channel.permissionOverwrites.edit(User.id, {
        ViewChannel: true,
        SendMessages: true
      });

      return Interaction.editReply({ content: `Ticket claimed by ${User.tag}` });
    }

    const TicketCategories = {
      Report: process.env.REPORT_CATEGORY,
      Appeal: process.env.APPEAL_CATEGORY,
      Inquiry: process.env.INQUIRY_CATEGORY
    };

    let CategoryId, Topic, Type;
    switch (Interaction.customId) {
      case "report_ticket": CategoryId = TicketCategories.Report; Topic = "Report a User"; Type = "Report"; break;
      case "appeal_ticket": CategoryId = TicketCategories.Appeal; Topic = "Appeal a Punishment"; Type = "Appeal"; break;
      case "inquiry_ticket": CategoryId = TicketCategories.Inquiry; Topic = "Inquiries"; Type = "Inquiry"; break;
      default: return;
    }

    const ExistingTicket = Object.values(ActiveTickets).find(T => T.ownerId === User.id && T.categoryType === Type);
    if (ExistingTicket) return Interaction.reply({ content: `You already have an open ${Type} ticket in this category. Please close it before creating a new one.`, ephemeral: true });

    const Channel = await Guild.channels.create({
      name: `ticket-${User.username}`,
      type: ChannelType.GuildText,
      parent: CategoryId,
      topic: `${Topic} | Opened by ${User.tag}`
    });

    const ParentCategory = Guild.channels.cache.get(CategoryId);
    if (ParentCategory) await SyncPermissions(Channel, ParentCategory, User.id);

    await Channel.permissionOverwrites.edit(User.id, { ViewChannel: true, SendMessages: true, AttachFiles: true });

    Client.TicketCounts[Type] += 1;
    const TicketNumber = Client.TicketCounts[Type];

    ActiveTickets[Channel.id] = { ownerId: User.id, claimerId: null, createdAt: Date.now(), categoryType: Type, ticketNumber: TicketNumber };
    await SaveTickets(ActiveTickets);

    const Buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("claim_ticket").setLabel("Claim Ticket").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("close_ticket").setLabel("Close Ticket").setStyle(ButtonStyle.Danger)
    );

    const TicketEmbed = new EmbedBuilder()
      .setTitle(`${Type} Ticket #${TicketNumber}`)
      .setDescription(`Hello ${User}, your ticket has been created. A staff member will be with you shortly.`)
      .setColor("Green")
      .setTimestamp();

    await Channel.send({ content: `<@${User.id}>`, embeds: [TicketEmbed], components: [Buttons] });
    await Interaction.reply({ content: `Your ${Type} ticket has been created: <#${Channel.id}>`, ephemeral: true });
  }
};
